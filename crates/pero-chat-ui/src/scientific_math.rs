//! LaTeX presentation values. Typesetting is never a scientific validity check.
use latex_rust::{MathFont, MathStyle, SvgOptions, layout, parse, render_svg};
use std::sync::OnceLock;

/// A prepared formula retains its source even when the renderer cannot handle it.
#[derive(Clone, Debug)]
pub struct Formula {
    pub source: String,
    pub display: Result<FormulaDisplay, String>,
}

#[derive(Clone, Debug)]
pub struct FormulaDisplay {
    pub svg: String,
    pub width_em: f32,
    pub height_em: f32,
    pub baseline_em: f32,
}

impl Formula {
    pub fn prepare(source: &str, block: bool) -> Self {
        static FONT: OnceLock<Result<MathFont, String>> = OnceLock::new();
        let display = (|| {
            if source.len() > 16 * 1024 {
                return Err("Formula exceeds 16 KiB; split it into smaller expressions".into());
            }
            let font = FONT
                .get_or_init(|| MathFont::stix_two_math().map_err(|e| e.to_string()))
                .as_ref()
                .map_err(Clone::clone)?;
            let ast = parse(source).map_err(|e| e.to_string())?;
            let tree = layout(
                &ast,
                font,
                if block {
                    MathStyle::Display
                } else {
                    MathStyle::Text
                },
            )
            .map_err(|e| e.to_string())?;
            let svg = render_svg(&tree, font, &SvgOptions::new()).map_err(|e| e.to_string())?;
            Ok(FormulaDisplay {
                svg,
                width_em: f32::from_bits(tree.width.to_ieee32_bits()),
                height_em: f32::from_bits((&tree.height + &tree.depth).to_ieee32_bits()),
                baseline_em: f32::from_bits(tree.height.to_ieee32_bits()),
            })
        })();
        Self {
            source: source.into(),
            display,
        }
    }
}

#[cfg(any(target_family = "wasm", feature = "native"))]
pub(crate) mod view {
    use super::Formula;
    use gpui_kit::{
        base::text::{
            InlineElement, InlineRenderContext, MarkdownNode, MarkdownParseContext, MarkdownPlugin,
        },
        component::{ActiveTheme as _, Sizable, button::*},
        prelude::*,
        *,
    };
    use markdown::mdast::Node;

    pub struct MathPlugin {
        pub block: bool,
    }

    impl MarkdownPlugin for MathPlugin {
        fn name(&self) -> &str {
            if self.block {
                "pero-equation"
            } else {
                "pero-inline-math"
            }
        }
        fn is_block(&self) -> bool {
            self.block
        }

        fn parse(&self, node: &Node, cx: &MarkdownParseContext<'_>) -> Option<MarkdownNode> {
            let source = match node {
                Node::Math(math) if self.block => &math.value,
                Node::InlineMath(math) if !self.block => &math.value,
                _ => return None,
            };
            // Dollar prices remain prose. Explicit mathematical content uses the
            // parser's normal code/escape boundaries; never rewrite the source.
            if !self.block
                && source.starts_with(|c: char| c.is_ascii_digit())
                && source.contains(" and ")
            {
                return None;
            }
            Some(
                MarkdownNode::new(self.name(), Formula::prepare(source, self.block))
                    .text(source.clone())
                    .markdown(cx.node_source(node).unwrap_or(source).to_owned()),
            )
        }

        fn render(
            &self,
            node: &MarkdownNode,
            _window: &mut Window,
            cx: &mut App,
        ) -> impl IntoElement {
            let formula = node.data::<Formula>().expect("prepared formula");
            let font = pero_theme::UiAppearance::global(cx).typography.chat;
            let source = formula.source.clone();
            let identity = node.source_range().map(|r| r.start).unwrap_or_default();
            div()
                .id(SharedString::from(format!("equation-{identity}")))
                .w_full()
                .min_w_0()
                .py_2()
                .child(match &formula.display {
                    Ok(display) => div()
                        .id("formula-scroll")
                        .w_full()
                        .overflow_x_scroll()
                        .child(
                            svg()
                                .data(display.svg.as_bytes())
                                .w(px(display.width_em * font))
                                .h(px(display.height_em * font))
                                .text_color(cx.theme().foreground),
                        )
                        .into_any_element(),
                    Err(error) => div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(formula.source.clone())
                        .child(
                            div()
                                .text_sm()
                                .text_color(cx.theme().danger)
                                .child(format!("LaTeX: {error}")),
                        )
                        .into_any_element(),
                })
                .child(
                    Button::new("copy-equation")
                        .ghost()
                        .small()
                        .label("LaTeX")
                        .icon(gpui_kit::component::IconName::Copy)
                        .on_click(move |_, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(source.clone()))
                        }),
                )
        }

        fn render_inline(
            &self,
            node: &MarkdownNode,
            context: &InlineRenderContext,
            _window: &mut Window,
            _cx: &mut App,
        ) -> Option<InlineElement> {
            let formula = node.data::<Formula>()?;
            match &formula.display {
                Ok(display) => Some(
                    InlineElement::new(
                        svg()
                            .data(display.svg.as_bytes())
                            .w(context.font_size() * display.width_em)
                            .h(context.font_size() * display.height_em)
                            .text_color(context.text_style().color),
                    )
                    .with_baseline(context.font_size() * display.baseline_em),
                ),
                // Preserve original delimiters for unsupported inline syntax.
                Err(_) => Some(InlineElement::new(
                    div().child(node.as_markdown().to_owned()),
                )),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scientific_expressions_preserve_source_and_report_local_failures() {
        for (source, valid) in [
            (
                r"\rho\left(\frac{\partial\mathbf{u}}{\partial t}+\mathbf{u}\cdot\nabla\mathbf{u}\right)=-\nabla p+\mu\nabla^2\mathbf{u}+\mathbf{f}",
                true,
            ),
            (
                r"\begin{aligned}\min_{\mathbf{u}_{0:T-1}}\quad&\sum_{t=0}^{T-1}\left(\mathbf{x}_t^\top Q\mathbf{x}_t+\mathbf{u}_t^\top R\mathbf{u}_t\right)\\\mathrm{s.t.}\quad&\mathbf{x}_{t+1}=A\mathbf{x}_t+B\mathbf{u}_t\end{aligned}",
                true,
            ),
            (r"\begin{bmatrix}1&2\\3&4\end{bmatrix}", true),
            (r"X_{ij}\sim\operatorname{NB}(\mu_{ij},\theta_j)", true),
            (r"\mathrm{2H_2+O_2\longrightarrow 2H_2O}", true),
            (r"\frac{1}{", false),
            (r"\notACommand{x}", false),
        ] {
            for block in [false, true] {
                let formula = Formula::prepare(source, block);
                assert_eq!(formula.source, source);
                assert_eq!(
                    formula.display.is_ok(),
                    valid,
                    "{source}: {:?}",
                    formula.display
                );
                if let Ok(display) = formula.display {
                    assert!(display.width_em > 0. && display.height_em > 0.);
                    assert!(display.svg.contains("<path"));
                    assert!(
                        !display.svg.contains("<text"),
                        "fonts must be self contained"
                    );
                }
            }
        }
    }
}
