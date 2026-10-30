//! 进程内 baseline JPEG(4:2:0, 无第三方库)。失败返回空字节。
//!
//! 尺寸报告来自编码后的 SOF,与 macOS `jpeg_dimensions` 同一契约。

const STD_LUM_QUANT: [u8; 64] = [
	16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51,
	87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
	72, 92, 95, 98, 112, 100, 103, 99,
];
const STD_CHR_QUANT: [u8; 64] = [
	17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99,
];
const ZIGZAG: [usize; 64] = [
	0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
	35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55,
	62, 63,
];

/// BGRA8 → JPEG。`quality` 是 0–1(与 ImageIO 同尺度)。非法输入 / 空缓冲 → 空。
pub fn encode_bgra(bgra: &[u8], width: u32, height: u32, max_px: u32, quality: f64) -> (Vec<u8>, u32, u32) {
	if width == 0 || height == 0 {
		return (Vec::new(), 0, 0);
	}
	let expected = (width as usize).saturating_mul(height as usize).saturating_mul(4);
	if bgra.len() < expected {
		return (Vec::new(), 0, 0);
	}
	let (src_w, src_h, pixels) = scale_nn(bgra, width, height, max_px.max(1));
	let q = quality.clamp(0.05, 1.0);
	let lum_q = scale_quant(&STD_LUM_QUANT, q);
	let chr_q = scale_quant(&STD_CHR_QUANT, q);
	let mut out = Vec::with_capacity(1024);
	write_headers(&mut out, src_w, src_h, &lum_q, &chr_q);
	encode_body(&mut out, &pixels, src_w, src_h, &lum_q, &chr_q);
	out.extend_from_slice(&[0xFF, 0xD9]);
	(out, src_w, src_h)
}

fn scale_quant(base: &[u8; 64], quality: f64) -> [u8; 64] {
	let scale = if quality < 0.5 { 5000.0 / (quality * 100.0) } else { 200.0 - quality * 200.0 };
	let mut out = [1u8; 64];
	for i in 0..64 {
		let v = ((f64::from(base[i]) * scale + 50.0) / 100.0).round();
		out[i] = v.clamp(1.0, 255.0) as u8;
	}
	out
}

fn scale_nn(bgra: &[u8], width: u32, height: u32, max_px: u32) -> (u32, u32, Vec<u8>) {
	let long = width.max(height);
	if long <= max_px {
		return (width, height, bgra[..width as usize * height as usize * 4].to_vec());
	}
	let scale = f64::from(max_px) / f64::from(long);
	let dw = (f64::from(width) * scale).round().max(1.0) as u32;
	let dh = (f64::from(height) * scale).round().max(1.0) as u32;
	let mut out = vec![0u8; dw as usize * dh as usize * 4];
	for y in 0..dh {
		let sy = (y as u64 * height as u64 / dh as u64) as u32;
		for x in 0..dw {
			let sx = (x as u64 * width as u64 / dw as u64) as u32;
			let si = ((sy * width + sx) * 4) as usize;
			let di = ((y * dw + x) * 4) as usize;
			out[di..di + 4].copy_from_slice(&bgra[si..si + 4]);
		}
	}
	(dw, dh, out)
}

fn write_headers(out: &mut Vec<u8>, width: u32, height: u32, lum_q: &[u8; 64], chr_q: &[u8; 64]) {
	out.extend_from_slice(&[0xFF, 0xD8]);
	write_dqt(out, 0, lum_q);
	write_dqt(out, 1, chr_q);
	out.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x11, 0x08]);
	out.extend_from_slice(&(height as u16).to_be_bytes());
	out.extend_from_slice(&(width as u16).to_be_bytes());
	out.extend_from_slice(&[0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
	write_dht(out);
	out.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x0C, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00]);
}

fn write_dqt(out: &mut Vec<u8>, dest: u8, table: &[u8; 64]) {
	out.extend_from_slice(&[0xFF, 0xDB, 0x00, 0x43, dest]);
	for &i in &ZIGZAG {
		out.push(table[i]);
	}
}

fn write_dht(out: &mut Vec<u8>) {
	out.extend_from_slice(&[0xFF, 0xC4]);
	let start = out.len();
	out.extend_from_slice(&[0x00, 0x00]);
	write_one_dht(out, 0x00, &DC_LUM_BITS, &DC_LUM_VAL);
	write_one_dht(out, 0x10, &AC_LUM_BITS, &AC_LUM_VAL);
	write_one_dht(out, 0x01, &DC_CHR_BITS, &DC_CHR_VAL);
	write_one_dht(out, 0x11, &AC_CHR_BITS, &AC_CHR_VAL);
	let len = (out.len() - start) as u16;
	out[start..start + 2].copy_from_slice(&len.to_be_bytes());
}

fn write_one_dht(out: &mut Vec<u8>, class_id: u8, bits: &[u8; 16], vals: &[u8]) {
	out.push(class_id);
	out.extend_from_slice(bits);
	out.extend_from_slice(vals);
}

const DC_LUM_BITS: [u8; 16] = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUM_VAL: [u8; 12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_CHR_BITS: [u8; 16] = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHR_VAL: [u8; 12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUM_BITS: [u8; 16] = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_CHR_BITS: [u8; 16] = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_LUM_VAL: [u8; 162] = [
	0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14,
	0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a,
	0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44,
	0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
	0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93,
	0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5,
	0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7,
	0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7,
	0xf8, 0xf9, 0xfa,
];
const AC_CHR_VAL: [u8; 162] = AC_LUM_VAL;

fn build_huff(bits: &[u8; 16], vals: &[u8]) -> [(u16, u8); 256] {
	let mut table = [(0u16, 0u8); 256];
	let mut code = 0u16;
	let mut k = 0usize;
	for (len_minus_1, &count) in bits.iter().enumerate() {
		let len = (len_minus_1 + 1) as u8;
		for _ in 0..count {
			table[vals[k] as usize] = (code, len);
			k += 1;
			code += 1;
		}
		code <<= 1;
	}
	table
}

struct BitWriter<'a> {
	out: &'a mut Vec<u8>,
	acc: u32,
	n: u8,
}

impl BitWriter<'_> {
	fn write(&mut self, bits: u16, len: u8) {
		if len == 0 {
			return;
		}
		self.acc = (self.acc << len) | u32::from(bits);
		self.n += len;
		while self.n >= 8 {
			self.n -= 8;
			let byte = (self.acc >> self.n) as u8;
			self.out.push(byte);
			if byte == 0xFF {
				self.out.push(0x00);
			}
		}
	}
	fn flush(&mut self) {
		if self.n > 0 {
			self.write(0x7F, 8 - self.n);
		}
	}
}

fn category(v: i32) -> u8 {
	let a = v.unsigned_abs();
	(32 - a.leading_zeros()) as u8
}

fn bits_of(v: i32, cat: u8) -> u16 {
	if cat == 0 {
		return 0;
	}
	let mask = (1u16 << cat) - 1;
	if v >= 0 { v as u16 } else { (v + (1 << cat) - 1) as u16 & mask }
}

fn fdct(block: &mut [f64; 64]) {
	let mut tmp = [0f64; 64];
	for i in 0..8 {
		let mut row = [0f64; 8];
		row.copy_from_slice(&block[i * 8..i * 8 + 8]);
		dct8(&mut row);
		tmp[i * 8..i * 8 + 8].copy_from_slice(&row);
	}
	for j in 0..8 {
		let mut col = [0f64; 8];
		for i in 0..8 {
			col[i] = tmp[i * 8 + j];
		}
		dct8(&mut col);
		for i in 0..8 {
			block[i * 8 + j] = col[i];
		}
	}
}

fn dct8(x: &mut [f64; 8]) {
	const C1: f64 = 0.980_785_280_403_230_4;
	const C2: f64 = 0.831_469_612_302_545_2;
	const C3: f64 = 0.555_570_233_019_602_2;
	const C4: f64 = 0.382_683_432_365_089_8;
	const S1: f64 = 0.195_090_322_016_128_25;
	const S2: f64 = 0.555_570_233_019_602_2;
	const S3: f64 = 0.831_469_612_302_545_2;
	const S4: f64 = 0.923_879_532_511_286_7;
	let (x0, x1, x2, x3, x4, x5, x6, x7) = (x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]);
	let (a0, a1, a2, a3) = (x0 + x7, x1 + x6, x2 + x5, x3 + x4);
	let (b0, b1, b2, b3) = (x0 - x7, x1 - x6, x2 - x5, x3 - x4);
	let (c0, c1, c2, c3) = (a0 + a3, a1 + a2, a0 - a3, a1 - a2);
	x[0] = 0.5 * (c0 + c1);
	x[4] = 0.5 * (c0 - c1);
	x[2] = 0.5 * (c2 * S4 + c3 * C4);
	x[6] = 0.5 * (c2 * C4 - c3 * S4);
	x[1] = 0.5 * (b0 * C1 + b1 * C2 + b2 * C3 + b3 * S1);
	x[7] = 0.5 * (b0 * S1 - b1 * C3 + b2 * C2 - b3 * C1);
	x[5] = 0.5 * (b0 * C3 - b1 * C1 + b2 * S1 + b3 * C2);
	x[3] = 0.5 * (b0 * C2 - b1 * S1 - b2 * C1 - b3 * C3);
	let _ = (S2, S3);
}

fn encode_body(out: &mut Vec<u8>, bgra: &[u8], width: u32, height: u32, lum_q: &[u8; 64], chr_q: &[u8; 64]) {
	let dc_lum = build_huff(&DC_LUM_BITS, &DC_LUM_VAL);
	let ac_lum = build_huff(&AC_LUM_BITS, &AC_LUM_VAL);
	let dc_chr = build_huff(&DC_CHR_BITS, &DC_CHR_VAL);
	let ac_chr = build_huff(&AC_CHR_BITS, &AC_CHR_VAL);
	let mut bw = BitWriter { out, acc: 0, n: 0 };
	let mut prev_y = 0i32;
	let mut prev_cb = 0i32;
	let mut prev_cr = 0i32;
	let mcu_w = width.div_ceil(16);
	let mcu_h = height.div_ceil(16);
	for my in 0..mcu_h {
		for mx in 0..mcu_w {
			for (by, bx) in [(0u32, 0u32), (0, 8), (8, 0), (8, 8)] {
				let block = sample_y(bgra, width, height, mx * 16 + bx, my * 16 + by);
				prev_y = encode_block(&mut bw, &block, lum_q, &dc_lum, &ac_lum, prev_y);
			}
			let (cb, cr) = sample_chroma(bgra, width, height, mx * 16, my * 16);
			prev_cb = encode_block(&mut bw, &cb, chr_q, &dc_chr, &ac_chr, prev_cb);
			prev_cr = encode_block(&mut bw, &cr, chr_q, &dc_chr, &ac_chr, prev_cr);
		}
	}
	bw.flush();
}

fn px(bgra: &[u8], width: u32, height: u32, x: u32, y: u32) -> (u8, u8, u8) {
	let x = x.min(width.saturating_sub(1));
	let y = y.min(height.saturating_sub(1));
	let i = ((y * width + x) * 4) as usize;
	(bgra[i + 2], bgra[i + 1], bgra[i])
}

fn rgb_to_ycbcr(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
	let r = f64::from(r);
	let g = f64::from(g);
	let b = f64::from(b);
	(0.299 * r + 0.587 * g + 0.114 * b, -0.168736 * r - 0.331264 * g + 0.5 * b + 128.0, 0.5 * r - 0.418688 * g - 0.081312 * b + 128.0)
}

fn sample_y(bgra: &[u8], width: u32, height: u32, ox: u32, oy: u32) -> [f64; 64] {
	let mut block = [0f64; 64];
	for y in 0..8u32 {
		for x in 0..8u32 {
			let (r, g, b) = px(bgra, width, height, ox + x, oy + y);
			block[(y * 8 + x) as usize] = rgb_to_ycbcr(r, g, b).0 - 128.0;
		}
	}
	block
}

fn sample_chroma(bgra: &[u8], width: u32, height: u32, ox: u32, oy: u32) -> ([f64; 64], [f64; 64]) {
	let mut cb = [0f64; 64];
	let mut cr = [0f64; 64];
	for y in 0..8u32 {
		for x in 0..8u32 {
			let (r, g, b) = px(bgra, width, height, ox + x * 2, oy + y * 2);
			let ycbcr = rgb_to_ycbcr(r, g, b);
			cb[(y * 8 + x) as usize] = ycbcr.1 - 128.0;
			cr[(y * 8 + x) as usize] = ycbcr.2 - 128.0;
		}
	}
	(cb, cr)
}

fn encode_block(
	bw: &mut BitWriter<'_>,
	spatial: &[f64; 64],
	quant: &[u8; 64],
	dc_huff: &[(u16, u8); 256],
	ac_huff: &[(u16, u8); 256],
	prev_dc: i32,
) -> i32 {
	let mut freq = *spatial;
	fdct(&mut freq);
	let mut zz = [0i32; 64];
	for (i, &zi) in ZIGZAG.iter().enumerate() {
		zz[i] = (freq[zi] / f64::from(quant[zi])).round() as i32;
	}
	let dc = zz[0];
	let diff = dc - prev_dc;
	let cat = category(diff);
	let (code, len) = dc_huff[cat as usize];
	bw.write(code, len);
	bw.write(bits_of(diff, cat), cat);
	let mut run = 0u8;
	for &coeff in &zz[1..] {
		if coeff == 0 {
			run += 1;
			continue;
		}
		while run >= 16 {
			let (code, len) = ac_huff[0xF0];
			bw.write(code, len);
			run -= 16;
		}
		let cat = category(coeff);
		let symbol = (run << 4) | cat;
		let (code, len) = ac_huff[symbol as usize];
		bw.write(code, len);
		bw.write(bits_of(coeff, cat), cat);
		run = 0;
	}
	if run > 0 {
		let (code, len) = ac_huff[0x00];
		bw.write(code, len);
	}
	dc
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::ffi::jpeg_dimensions;

	#[test]
	fn encodes_a_tiny_bgra_block() {
		let mut bgra = vec![0u8; 8 * 8 * 4];
		for i in 0..8 * 8 {
			bgra[i * 4] = 40;
			bgra[i * 4 + 1] = 80;
			bgra[i * 4 + 2] = 200;
			bgra[i * 4 + 3] = 255;
		}
		let (jpeg, w, h) = encode_bgra(&bgra, 8, 8, 1280, 0.55);
		assert!(!jpeg.is_empty());
		assert_eq!((w, h), (8, 8));
		assert_eq!(jpeg_dimensions(&jpeg), (8, 8));
		assert_eq!(jpeg[..2], [0xFF, 0xD8]);
		assert_eq!(jpeg[jpeg.len() - 2..], [0xFF, 0xD9]);
	}

	#[test]
	fn empty_or_short_input_is_empty() {
		assert!(encode_bgra(&[], 10, 10, 1280, 0.5).0.is_empty());
		assert!(encode_bgra(&[0; 4], 0, 1, 1280, 0.5).0.is_empty());
	}

	#[test]
	fn nearest_neighbor_downscales_long_edge() {
		let bgra = vec![0u8; 40 * 20 * 4];
		let (_jpeg, w, h) = encode_bgra(&bgra, 40, 20, 20, 0.5);
		assert_eq!((w, h), (20, 10));
	}
}
