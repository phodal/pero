//! AT-SPI over the session's accessibility bus. Object paths and bus names stay in
//! this adapter's snapshot; the model only sees Pero element references.
use super::model::{Binding, DEPTH_BUDGET, Extents, NODE_BUDGET, NodeFacts, States, bind};
use computer_core::{ControlId, WindowBounds};
use computer_runtime::error;
use pero_contracts::computer_use::*;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use zbus::blocking::Connection;
use zbus::zvariant::{DynamicType, OwnedObjectPath, OwnedValue, Type};

const ACCESSIBLE: &str = "org.a11y.atspi.Accessible";
const COMPONENT: &str = "org.a11y.atspi.Component";
const ACTION: &str = "org.a11y.atspi.Action";
const REGISTRY: &str = "org.a11y.atspi.Registry";
const ROOT: &str = "/org/a11y/atspi/accessible/root";
const COORDS_SCREEN: u32 = 0;
const TIMEOUT: Duration = Duration::from_secs(2);
/// Whole-observation budget, well inside the Host's per-request limit.
const OBSERVE_BUDGET: Duration = Duration::from_secs(8);

#[derive(Clone, Debug)]
pub struct Node {
    bus: String,
    path: OwnedObjectPath,
}

/// One element the snapshot can act on: its object and the Action index for click.
#[derive(Clone, Debug)]
pub struct ElementTarget {
    node: Node,
    action: i32,
}

pub struct AccessibleTree {
    pub elements: Vec<ComputerElement>,
    pub targets: Vec<Option<ElementTarget>>,
    pub truncated: bool,
}

pub struct Accessibility {
    bus: Connection,
}

fn unavailable(message: impl std::fmt::Display) -> ComputerError {
    error(ComputerErrorCode::TargetUnavailable, message.to_string())
}

impl Accessibility {
    /// Connects to the accessibility bus advertised on the session bus.
    pub fn connect() -> Result<Self, String> {
        let session =
            Connection::session().map_err(|e| format!("Session D-Bus unavailable: {e}"))?;
        let address: String = session
            .call_method(
                Some("org.a11y.Bus"),
                "/org/a11y/bus",
                Some("org.a11y.Bus"),
                "GetAddress",
                &(),
            )
            .and_then(|reply| reply.body().deserialize())
            .map_err(|e| format!("AT-SPI bus unavailable: {e}"))?;
        let bus = zbus::blocking::connection::Builder::address(address.as_str())
            .and_then(|builder| builder.method_timeout(TIMEOUT).build())
            .map_err(|e| format!("AT-SPI bus connection failed: {e}"))?;
        let accessibility = Self { bus };
        accessibility
            .children(&Node {
                bus: REGISTRY.into(),
                path: OwnedObjectPath::try_from(ROOT).unwrap(),
            })
            .map_err(|e| format!("AT-SPI registry unavailable: {e}"))?;
        Ok(accessibility)
    }

    fn call<B, R>(&self, node: &Node, interface: &str, method: &str, body: &B) -> zbus::Result<R>
    where
        B: Serialize + DynamicType,
        R: for<'d> Deserialize<'d> + Type,
    {
        self.bus
            .call_method(
                Some(node.bus.as_str()),
                node.path.as_str(),
                Some(interface),
                method,
                body,
            )?
            .body()
            .deserialize()
    }
    fn property<R: TryFrom<OwnedValue>>(
        &self,
        node: &Node,
        interface: &str,
        name: &str,
    ) -> Option<R> {
        let value: OwnedValue = self
            .call(
                node,
                "org.freedesktop.DBus.Properties",
                "Get",
                &(interface, name),
            )
            .ok()?;
        R::try_from(value).ok()
    }
    fn children(&self, node: &Node) -> zbus::Result<Vec<Node>> {
        let children: Vec<(String, OwnedObjectPath)> =
            self.call(node, ACCESSIBLE, "GetChildren", &())?;
        Ok(children
            .into_iter()
            .filter(|(bus, path)| !bus.is_empty() && path.as_str() != "/org/a11y/atspi/null")
            .map(|(bus, path)| Node { bus, path })
            .collect())
    }
    /// The process that owns a bus name, as reported by the bus itself.
    fn pid(&self, bus: &str) -> Option<i32> {
        let pid: u32 = self
            .bus
            .call_method(
                Some("org.freedesktop.DBus"),
                "/org/freedesktop/DBus",
                Some("org.freedesktop.DBus"),
                "GetConnectionUnixProcessID",
                &(bus,),
            )
            .ok()?
            .body()
            .deserialize()
            .ok()?;
        i32::try_from(pid).ok()
    }
    fn states(&self, node: &Node) -> zbus::Result<States> {
        let words: Vec<u32> = self.call(node, ACCESSIBLE, "GetState", &())?;
        Ok(States([
            words.first().copied().unwrap_or(0),
            words.get(1).copied().unwrap_or(0),
        ]))
    }
    fn extents(&self, node: &Node) -> Option<Extents> {
        let (x, y, w, h): (i32, i32, i32, i32) = self
            .call(node, COMPONENT, "GetExtents", &(COORDS_SCREEN,))
            .ok()?;
        Some(Extents { x, y, w, h })
    }
    fn facts(&self, node: &Node) -> zbus::Result<NodeFacts> {
        let role: u32 = self.call(node, ACCESSIBLE, "GetRole", &())?;
        let role_name: String = self.call(node, ACCESSIBLE, "GetRoleName", &())?;
        let interfaces: Vec<String> = self.call(node, ACCESSIBLE, "GetInterfaces", &())?;
        let mut actions = Vec::new();
        if interfaces.iter().any(|name| name == ACTION) {
            let count: i32 = self.property(node, ACTION, "NActions").unwrap_or(0);
            for index in 0..count.clamp(0, 16) {
                actions.push(self.call(node, ACTION, "GetName", &(index,))?);
            }
        }
        Ok(NodeFacts {
            role,
            role_name,
            name: self.property(node, ACCESSIBLE, "Name").unwrap_or_default(),
            states: self.states(node)?,
            actions,
        })
    }

    /// Binds the X11 window to one accessible frame of the same process, then reads
    /// its rendered subtree within the node and depth budgets.
    pub fn observe(&self, pid: i32, bounds: WindowBounds) -> Result<AccessibleTree, String> {
        let registry = Node {
            bus: REGISTRY.into(),
            path: OwnedObjectPath::try_from(ROOT).unwrap(),
        };
        let mut candidates = Vec::new();
        for application in self.children(&registry).map_err(|e| e.to_string())? {
            if self.pid(&application.bus) != Some(pid) {
                continue;
            }
            for frame in self.children(&application).unwrap_or_default() {
                if let Some(extents) = self.extents(&frame) {
                    candidates.push((pid, extents, frame));
                }
            }
            if candidates.is_empty() {
                // The process is on the bus but exposes no frames yet.
                candidates.push((
                    pid,
                    Extents {
                        x: 0,
                        y: 0,
                        w: 0,
                        h: 0,
                    },
                    application,
                ));
            }
        }
        let root = match bind(&candidates, pid, bounds) {
            Binding::Bound(root) => root,
            Binding::NoApplication => {
                return Err("The target process does not expose an accessibility tree".into());
            }
            Binding::NoWindow => {
                return Err(
                    "No accessible frame of this process matches the window geometry".into(),
                );
            }
            Binding::Ambiguous => {
                return Err(
                    "Several accessible frames match this window; refusing to guess".into(),
                );
            }
        };
        let mut tree = AccessibleTree {
            elements: Vec::new(),
            targets: Vec::new(),
            truncated: false,
        };
        let deadline = std::time::Instant::now() + OBSERVE_BUDGET;
        let mut visited = 0usize;
        let mut stack = vec![(root, 0u16)];
        while let Some((node, depth)) = stack.pop() {
            // Every visited node costs bus round trips, rendered or not.
            if visited >= NODE_BUDGET || std::time::Instant::now() >= deadline {
                tree.truncated = true;
                break;
            }
            visited += 1;
            let Ok(facts) = self.facts(&node) else {
                // The object vanished while reading; the tree is no longer complete.
                tree.truncated = true;
                continue;
            };
            if !facts.states.rendered() {
                continue;
            }
            let index = ControlId(tree.elements.len() as u32);
            let (control, action) = facts.control(index, depth);
            tree.elements.push(control.into_element());
            tree.targets.push(action.map(|action| ElementTarget {
                node: node.clone(),
                action,
            }));
            if depth >= DEPTH_BUDGET {
                tree.truncated = true;
                continue;
            }
            match self.children(&node) {
                Ok(children) => stack.extend(children.into_iter().rev().map(|c| (c, depth + 1))),
                Err(_) => tree.truncated = true,
            }
        }
        Ok(tree)
    }

    /// Invokes the observed click Action without pointer or focus changes.
    /// Re-checks a snapshot element before any input: same process, still
    /// present, enabled and visible. Failures here are certain refusals.
    pub fn check(&self, target: &ElementTarget, pid: i32) -> Result<(), ComputerError> {
        if self.pid(&target.node.bus) != Some(pid) {
            return Err(unavailable(
                "The element no longer belongs to the target process",
            ));
        }
        let states = self
            .states(&target.node)
            .map_err(|_| unavailable("The element no longer exists; observe again"))?;
        if !states.actionable() || !states.rendered() {
            return Err(unavailable(
                "The element is no longer enabled and visible; observe again",
            ));
        }
        Ok(())
    }

    /// Invokes the observed click Action without pointer or focus changes.
    pub fn click(&self, target: &ElementTarget) -> Result<(), ComputerError> {
        let done: bool = self
            .call(&target.node, ACTION, "DoAction", &(target.action,))
            .map_err(|e| error(ComputerErrorCode::Failed, e.to_string()))?;
        if done {
            Ok(())
        } else {
            Err(error(
                ComputerErrorCode::Failed,
                "The application declined the action",
            ))
        }
    }
}
