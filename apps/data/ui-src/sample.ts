import type { Asset, Row } from './model';

function generateServo(base = false): Row[] {
  return Array.from({ length: 61 }, (_, i) => {
    const t = i * .1;
    const d = base ? .63 : .85;
    const a = base ? .22 : .11;
    const response = 1 - Math.exp(-d * t) * (Math.cos(3.25 * t) + a * Math.sin(3.25 * t));
    return {
      time_s: +t.toFixed(2), setpoint: 1,
      response: (!base && (i === 15 || i === 42)) ? null : +response.toFixed(5),
      control: +(0.8 * Math.exp(-.35 * t) * Math.cos(2.1 * t)).toFixed(5),
    };
  });
}

function genTelemetry(): Row[] {
  return Array.from({ length: 72 }, (_, i) => ({
    timestamp: `2026-10-30T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
    temperature_c: [9, 22, 51, 60].includes(i) ? null : +(24.2 + Math.sin(i / 7) * 1.35 + (i > 46 ? 0.5 : 0)).toFixed(3),
    rpm: Math.round(1420 + 160 * Math.sin(i / 13)),
    current_a: i === 40 ? null : +(1.82 + .18 * Math.cos(i / 8)).toFixed(3),
  }));
}

function genWind(): Row[] {
  return Array.from({ length: 40 }, (_, i) => ({
    time_s: +(i * .1).toFixed(2),
    gust_m_s: +(1.5 * Math.sin(i / 5)).toFixed(3),
    angle_deg: i === 18 ? null : +(2 * Math.sin(i / 6) * Math.exp(-i / 35)).toFixed(3),
  }));
}

export function seedAssets(): Asset[] {
  return [
    { id: 'servo-response', name: 'servo-response.csv', kind: 'Time series', format: 'CSV', source: 'Simulation App', description: 'Closed-loop step response, candidate P3', updated: 'Oct 31', updatedRank: 9, rows: generateServo(), units: { time_s: 's', setpoint: 'normalized', response: 'normalized', control: 'normalized' } },
    { id: 'motor-telemetry', name: 'motor-telemetry.csv', kind: 'Table', format: 'CSV', source: 'Local files', description: 'Test bench sensor recordings', updated: 'Oct 31', updatedRank: 8, rows: genTelemetry(), units: { timestamp: 'UTC', temperature_c: '\u00b0C', rpm: 'rpm', current_a: 'A' } },
    { id: 'plant-model', name: 'plant-model.json', kind: 'Model', format: 'JSON', source: 'Local files', description: 'Second-order transfer function parameters', updated: 'Oct 30', updatedRank: 6, rows: [{ model: 'second-order', natural_frequency_rad_s: 3.25, damping_ratio: 0.34, gain: 1 }], units: { natural_frequency_rad_s: 'rad/s', damping_ratio: '', gain: '' } },
    { id: 'baseline-response', name: 'baseline-response.csv', kind: 'Time series', format: 'CSV', source: 'Simulation App', description: 'Reference step response for comparison', updated: 'Oct 30', updatedRank: 5, rows: generateServo(true), units: { time_s: 's', setpoint: 'normalized', response: 'normalized', control: 'normalized' } },
    { id: 'verification-metrics', name: 'response-metrics.json', kind: 'Records', format: 'JSON', source: 'Simulation App', description: 'Computed response metrics', updated: 'Oct 29', updatedRank: 4, rows: [{ metric: 'overshoot_pct', value: 12.4, status: 'Review' }, { metric: 'settling_time_s', value: 2.12, status: 'Recorded' }, { metric: 'steady_state_error_pct', value: 0.6, status: 'Recorded' }], units: { value: 'varies' } },
    { id: 'wind-test', name: 'wind-disturbance.csv', kind: 'Time series', format: 'CSV', source: 'Lab storage', description: 'Synthetic wind disturbance series', updated: 'Oct 27', updatedRank: 3, rows: genWind(), units: { time_s: 's', gust_m_s: 'm/s', angle_deg: 'deg' } },
  ];
}
