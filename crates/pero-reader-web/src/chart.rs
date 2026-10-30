use crate::chart_lines::MultiLine;
use gpui_kit::{
    component::{
        ActiveTheme,
        chart::{
            AreaChart, BarChart, CandlestickChart, LineChart, PieChart, RadarChart, SankeyChart,
        },
        plot::shape::SankeyLink,
    },
    prelude::*,
    *,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChartDocument {
    schema_version: u32,
    chart: ChartSpec,
    rows: Vec<HashMap<String, Value>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChartSpec {
    #[serde(rename = "type")]
    kind: String,
    x: String,
    y: Option<String>,
    series: Option<String>,
    target: Option<String>,
    open: Option<String>,
    high: Option<String>,
    low: Option<String>,
    close: Option<String>,
}

#[derive(Clone)]
struct Point {
    index: usize,
    x: String,
    y: f64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
}

pub struct Chart {
    kind: String,
    points: Vec<Point>,
    nodes: Vec<String>,
    links: Vec<SankeyLink>,
    multi_line: Option<MultiLine>,
}

impl Chart {
    pub fn parse(json: &str) -> Result<Self, String> {
        let document: ChartDocument = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if document.schema_version != 1 {
            return Err("Unsupported chart schema version".into());
        }
        let spec = document.chart;
        if spec.series.is_some() && spec.kind != "line" {
            return Err("This chart surface does not yet support series".into());
        }
        if ![
            "line",
            "bar",
            "area",
            "pie",
            "radar",
            "candlestick",
            "sankey",
        ]
        .contains(&spec.kind.as_str())
        {
            return Err("Unsupported chart type".into());
        }
        if document.rows.is_empty() {
            return Err("Chart has no rows".into());
        }
        let mut points = Vec::new();
        let mut nodes = Vec::new();
        let mut links = Vec::new();
        let special_line = spec.kind == "line"
            && (spec.series.is_some()
                || document.rows.iter().any(|row| {
                    spec.y
                        .as_ref()
                        .and_then(|name| row.get(name))
                        .is_some_and(Value::is_null)
                }));
        let mut line_rows = Vec::new();
        for (row_index, row) in document.rows.iter().enumerate() {
            let label = |field: &str| -> Result<String, String> {
                row.get(field)
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .ok_or_else(|| format!("Chart field {field} must be a non-null string"))
            };
            let number = |field: Option<&String>| -> Result<f64, String> {
                let field = field.ok_or_else(|| "Chart measure field is missing".to_string())?;
                row.get(field)
                    .and_then(Value::as_f64)
                    .filter(|v| v.is_finite())
                    .ok_or_else(|| format!("Chart field {field} must be a non-null finite number"))
            };
            let x = label(&spec.x)?;
            if special_line {
                let series = spec
                    .series
                    .as_ref()
                    .map(|name| label(name))
                    .transpose()?
                    .unwrap_or_default();
                let field = spec.y.as_ref().ok_or("Chart measure field is missing")?;
                let value = row
                    .get(field)
                    .ok_or_else(|| format!("Chart field {field} is missing"))?;
                let y = if value.is_null() {
                    None
                } else {
                    Some(value.as_f64().filter(|v| v.is_finite()).ok_or_else(|| {
                        format!("Chart field {field} must be a finite number or null")
                    })?)
                };
                line_rows.push((x, series, y));
            } else if spec.kind == "sankey" {
                let target = label(
                    spec.target
                        .as_deref()
                        .ok_or("Sankey target field is missing")?,
                )?;
                let value = number(spec.y.as_ref())?;
                if value < 0. {
                    return Err("Sankey values cannot be negative".into());
                }
                let index = |nodes: &mut Vec<String>, name: String| {
                    if let Some(index) = nodes.iter().position(|node| node == &name) {
                        index
                    } else {
                        nodes.push(name);
                        nodes.len() - 1
                    }
                };
                let source = index(&mut nodes, x);
                let target = index(&mut nodes, target);
                links.push(SankeyLink::new(source, target, value));
            } else if spec.kind == "candlestick" {
                points.push(Point {
                    index: row_index,
                    x,
                    y: 0.,
                    open: number(spec.open.as_ref())?,
                    high: number(spec.high.as_ref())?,
                    low: number(spec.low.as_ref())?,
                    close: number(spec.close.as_ref())?,
                });
            } else {
                let y = number(spec.y.as_ref())?;
                if ["pie", "radar"].contains(&spec.kind.as_str()) && y < 0. {
                    return Err("Pie and radar values cannot be negative".into());
                }
                if spec.kind == "pie" && (!(y as f32).is_finite() || (y != 0. && y as f32 == 0.)) {
                    return Err("Pie value exceeds the chart's numeric range".into());
                }
                points.push(Point {
                    index: row_index,
                    x,
                    y,
                    open: 0.,
                    high: 0.,
                    low: 0.,
                    close: 0.,
                });
            }
        }
        Ok(Self {
            kind: spec.kind,
            points,
            nodes,
            links,
            multi_line: if special_line {
                Some(MultiLine::new(line_rows)?)
            } else {
                None
            },
        })
    }

    pub fn render(&self, cx: &App) -> AnyElement {
        let theme = cx.theme();
        let colors = [
            theme.chart_1,
            theme.chart_2,
            theme.chart_3,
            theme.chart_4,
            theme.chart_5,
        ];
        let points = self.points.clone();
        if let Some(line) = &self.multi_line {
            return line.render(cx);
        }
        match self.kind.as_str() {
            "line" => LineChart::new(points)
                .x(|p: &Point| p.x.clone())
                .y(|p| p.y)
                .y_axis(true)
                .into_any_element(),
            "bar" => BarChart::new(points)
                .band(|p: &Point| p.x.clone())
                .value(|p| p.y)
                .value_axis(true)
                .into_any_element(),
            "area" => AreaChart::new(points)
                .x(|p: &Point| p.x.clone())
                .y(|p| p.y)
                .y_axis(true)
                .into_any_element(),
            "pie" => PieChart::new(points)
                .value(|p: &Point| p.y as f32)
                .color(move |p| colors[p.index % colors.len()])
                .pad_angle(0.01)
                .label(|p| p.x.clone().into())
                .tooltip_name(|p| p.x.clone().into())
                .into_any_element(),
            "radar" => RadarChart::new(points)
                .label(|p: &Point| p.x.clone())
                .value(|p| p.y)
                .into_any_element(),
            "candlestick" => CandlestickChart::new(points)
                .x(|p: &Point| p.x.clone())
                .open(|p| p.open)
                .high(|p| p.high)
                .low(|p| p.low)
                .close(|p| p.close)
                .into_any_element(),
            "sankey" => SankeyChart::new(self.nodes.clone(), self.links.clone())
                .node_label(|n: &String| n.clone().into())
                .tooltip_name(|n| n.clone().into())
                .into_any_element(),
            _ => unreachable!(),
        }
    }
}
