//! Multi-series lines use the Kit plot primitives so missing values split paths.
use gpui_kit::{
    component::{
        ActiveTheme, h_flex,
        plot::{AxisLabelSide, AxisText, Grid, Plot, PlotAxis, PlotElement, shape::Line},
        v_flex,
    },
    prelude::*,
    *,
};
use std::collections::HashMap;

#[derive(Clone)]
struct Series {
    name: String,
    values: Vec<Option<f64>>,
}

#[derive(Clone)]
pub struct MultiLine {
    labels: Vec<String>,
    series: Vec<Series>,
}

impl MultiLine {
    pub fn new(rows: Vec<(String, String, Option<f64>)>) -> Result<Self, String> {
        let mut labels = Vec::new();
        let mut names = Vec::new();
        let mut values = HashMap::new();
        for (x, series, value) in rows {
            if !labels.contains(&x) {
                labels.push(x.clone());
            }
            if !names.contains(&series) {
                names.push(series.clone());
            }
            if values.insert((x, series), value).is_some() {
                return Err("Repeated line coordinates cannot be represented distinctly".into());
            }
        }
        if names.len() > 5 {
            return Err("A line chart supports up to five distinct series".into());
        }
        let min = values.values().flatten().copied().fold(0.0_f64, f64::min);
        let max = values.values().flatten().copied().fold(0.0_f64, f64::max);
        if !(max - min).is_finite() {
            return Err("Line values exceed the plotting range".into());
        }
        let series = names
            .into_iter()
            .map(|name| {
                let data = labels
                    .iter()
                    .map(|x| values.get(&(x.clone(), name.clone())).copied().flatten())
                    .collect();
                Series { name, values: data }
            })
            .collect();
        Ok(Self { labels, series })
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
        let legend = self
            .series
            .iter()
            .enumerate()
            .map(|(i, series)| {
                h_flex()
                    .items_center()
                    .gap_1()
                    .child(
                        div()
                            .size(px(8.))
                            .rounded_full()
                            .bg(colors[i % colors.len()]),
                    )
                    .child(div().text_sm().child(if series.name.is_empty() {
                        "Value".to_string()
                    } else {
                        series.name.clone()
                    }))
            })
            .collect::<Vec<_>>();
        let has_values = self
            .series
            .iter()
            .any(|series| series.values.iter().any(Option::is_some));
        let chart = if has_values {
            div()
                .flex_1()
                .min_h(px(100.))
                .child(PlotElement::new(LinePlot { data: self.clone() }))
        } else {
            div().flex_1().child("No observed values")
        };
        v_flex()
            .size_full()
            .child(h_flex().flex_wrap().gap_3().children(legend))
            .child(chart)
            .into_any_element()
    }
}

struct LinePlot {
    data: MultiLine,
}

impl IntoElement for LinePlot {
    type Element = PlotElement<Self>;
    fn into_element(self) -> Self::Element {
        PlotElement::new(self)
    }
}

impl Plot for LinePlot {
    fn paint(&mut self, bounds: Bounds<Pixels>, window: &mut Window, cx: &mut App) {
        let width = bounds.size.width.as_f32();
        let height = bounds.size.height.as_f32();
        let left = 64.;
        let right = 20.;
        let top = 12.;
        let bottom = height - 24.;
        if width <= left + right || bottom <= top {
            return;
        }
        let values: Vec<_> = self
            .data
            .series
            .iter()
            .flat_map(|s| s.values.iter().flatten().copied())
            .collect();
        if values.is_empty() {
            return;
        }
        let min = values.iter().copied().fold(0.0_f64, f64::min);
        let max = values.iter().copied().fold(0.0_f64, f64::max);
        let span = max - min;
        if !span.is_finite() {
            return;
        }
        let span = if span == 0. { 1. } else { span };
        let x = |index: usize| {
            left + (width - left - right) * index as f32
                / (self.data.labels.len().saturating_sub(1).max(1) as f32)
        };
        let y = |value: f64| bottom - ((value - min) / span) as f32 * (bottom - top);
        let color = cx.theme().muted_foreground;
        let step = self.data.labels.len().div_ceil(5).max(1);
        let x_labels = self
            .data
            .labels
            .iter()
            .enumerate()
            .filter(|(i, _)| i % step == 0 || *i + 1 == self.data.labels.len())
            .map(|(i, label)| {
                AxisText::new(label.clone(), px(x(i)), color).align(TextAlign::Center)
            });
        let y_labels = (0..=4).map(|i| {
            let value = min + span * i as f64 / 4.;
            let label = if value != 0. && (value.abs() < 0.01 || value.abs() >= 1_000_000.) {
                format!("{value:.2e}")
            } else {
                format!("{value:.2}")
            };
            AxisText::new(label, px(y(value)), color).align(TextAlign::Right)
        });
        let plot_bounds = Bounds::new(
            bounds.origin + point(px(left), px(0.)),
            size(px(width - left - right), bounds.size.height),
        );
        Grid::new()
            .y((0..=4).map(|i| px(bottom - (bottom - top) * i as f32 / 4.)))
            .stroke(cx.theme().chart_grid)
            .paint(&plot_bounds, window);
        PlotAxis::new()
            .x(bottom)
            .y(left)
            .y_axis(true)
            .y_label_side(AxisLabelSide::Start)
            .x_label(x_labels)
            .y_label(y_labels)
            .stroke(cx.theme().border)
            .paint(&bounds, window, cx);
        let colors = [
            cx.theme().chart_1,
            cx.theme().chart_2,
            cx.theme().chart_3,
            cx.theme().chart_4,
            cx.theme().chart_5,
        ];
        for (index, series) in self.data.series.iter().enumerate() {
            let mut segment = Vec::new();
            for (i, value) in series
                .values
                .iter()
                .enumerate()
                .chain(std::iter::once((series.values.len(), &None)))
            {
                if let Some(value) = value {
                    segment.push((x(i), y(*value)));
                } else if !segment.is_empty() {
                    Line::new()
                        .data(std::mem::take(&mut segment))
                        .x(|p: &(f32, f32)| Some(p.0))
                        .y(|p| Some(p.1))
                        .stroke(colors[index % colors.len()])
                        .stroke_width(2.)
                        .dot()
                        .dot_size(5.)
                        .dot_fill(colors[index % colors.len()])
                        .paint(&bounds, window);
                }
            }
        }
    }
}
