use super::*;

// ── 窗口捕获 + JPEG 编码(REF capture_window_jpeg / jpeg_dimensions) ──

/// CFNumber 构造(i32);截图选项字典用。
pub(crate) fn cf_number_i32_value(value: i32) -> Option<CfRef> {
	// SAFETY:纯 Create 调用;value 是匹配 K_CF_NUMBER_SINT32 的缓冲。
	let ptr = unsafe { sys::CFNumberCreate(std::ptr::null(), K_CF_NUMBER_SINT32, &raw const value as *const c_void) };
	// SAFETY:Create-Rule +1。
	unsafe { CfRef::from_created(ptr as *mut c_void) }
}

/// CFNumber 构造(f64)。
pub(crate) fn cf_number_f64_value(value: f64) -> Option<CfRef> {
	// SAFETY:同上,double 缓冲。
	let ptr = unsafe { sys::CFNumberCreate(std::ptr::null(), K_CF_NUMBER_DOUBLE, &raw const value as *const c_void) };
	unsafe { CfRef::from_created(ptr as *mut c_void) }
}

/// 捕获一个窗口的像素并 JPEG 编码,全程进程内。
///
/// 返回 `(jpeg 字节, 宽, 高)`;窗口不可捕获(已关/无效 id → NULL image,
/// 实测如此、不是崩溃)或编码失败时 `(空, 0, 0)`。降 scale 由 ImageIO 经
/// `kCGImageDestinationImageMaxPixelSize` 自己完成 —— 无子进程、无图像
/// 库、无 204ms 的进程启动。全零 CGRect 意为「窗口自身的 bounds」,这正
/// 是把捕获限定在**一个窗口**而非屏幕的东西。
pub fn capture_window_jpeg(window_id: u32, max_px: u32, quality: f64) -> (Vec<u8>, u32, u32) {
	let empty = (Vec::new(), 0, 0);
	// SAFETY:全零 CGRect = 窗口自身 bounds;INCLUDING_WINDOW + 单 id 把
	//列表收窄到这一个窗口;常量为图像选项。
	let image = unsafe {
		sys::CGWindowListCreateImage(
			CGRect::default(),
			K_CG_WINDOW_LIST_INCLUDING_WINDOW,
			window_id,
			K_CG_WINDOW_IMAGE_BOUNDS_IGNORE_FRAMING,
		)
	};
	if image.is_null() {
		return empty;
	}
	// 无论后面哪一步失败,图像本身都必须释放 —— 借 RAII 把引用接管过来。
	// SAFETY:CGWindowListCreateImage 是 Create Rule(+1);null 复核由
	// from_created 再做一次(与上面的裸指针检查等价,保留一道即可)。
	let Some(image) = (unsafe { CfRef::from_created(image as *mut c_void) }) else { return empty };

	let Some(data) = cf_mutable_data() else { return empty };
	let Some(uti) = cf_string(UTI_JPEG) else { return empty };
	// SAFETY:data/uti 合法;count=1 张图;无选项。
	let dest = unsafe { sys::CGImageDestinationCreateWithData(data.as_ptr(), uti.as_ptr(), 1, std::ptr::null()) };
	// SAFETY:Create-Rule +1。
	let Some(dest) = (unsafe { CfRef::from_created(dest as *mut c_void) }) else { return empty };

	let encoded = encode_with_options(&dest, &image, max_px, quality);
	if !encoded {
		return empty;
	}
	// SAFETY:data 是我们创建的合法 CFMutableData。
	let (length, bytes) = unsafe { (sys::CFDataGetLength(data.as_ptr()), sys::CFDataGetBytePtr(data.as_ptr())) };
	if length <= 0 || bytes.is_null() {
		return empty;
	}
	// SAFETY:bytes 指向 data 拥有的 length 字节;立即拷出,不悬垂引用。
	let raw = unsafe { std::slice::from_raw_parts(bytes, length as usize) }.to_vec();
	let (width, height) = jpeg_dimensions(&raw);
	(raw, width, height)
}

fn cf_mutable_data() -> Option<CfRef> {
	// SAFETY:纯 Create 调用;capacity=0 表示按需增长。
	let ptr = unsafe { sys::CFDataCreateMutable(std::ptr::null(), 0) };
	// SAFETY:Create-Rule +1。
	unsafe { CfRef::from_created(ptr as *mut c_void) }
}

/// 把 *image* 编码进 *dest*,带上降 scale 与质量选项;`false` = 编码失败
/// (调用方降级为「无图」—— 树是主通道,一次编码失败不该弄败整个观测)。
fn encode_with_options(dest: &CfRef, image: &CfRef, max_px: u32, quality: f64) -> bool {
	let Some(options) = cf_type_dict() else { return false };
	let (Some(num_max), Some(num_quality)) = (cf_number_i32_value(max_px as i32), cf_number_f64_value(quality)) else {
		return false;
	};
	// SAFETY:全部为合法 CF 对象;两个键是 ImageIO 导出的共享 CFStringRef
	//静态量,读 .value 即键本身。
	unsafe {
		sys::CFDictionarySetValue(options.as_ptr(), sys::kCGImageDestinationImageMaxPixelSize, num_max.as_ptr());
		sys::CFDictionarySetValue(
			options.as_ptr(),
			sys::kCGImageDestinationLossyCompressionQuality,
			num_quality.as_ptr(),
		);
		sys::CGImageDestinationAddImage(dest.as_ptr(), image.as_ptr(), options.as_ptr());
		sys::CGImageDestinationFinalize(dest.as_ptr())
	}
}

// JPEG 标记字节(jpeg_dimensions 用)。
const JPEG_MARKER: u8 = 0xFF;
const JPEG_SOI: u8 = 0xD8;
const JPEG_EOI: u8 = 0xD9;
const JPEG_SOF_MARKERS: &[u8] = &[0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB];
const JPEG_RST_FIRST: u8 = 0xD0;
const JPEG_RST_LAST: u8 = 0xD7;
/// 从段标记字节到「高(2B) 宽(2B)」的字节距离。
const JPEG_SOF_DIMENSION_OFFSET: usize = 5;

/// 从 JPEG 字节里解析 `(宽, 高)`;不可解析 `(0, 0)`。
///
/// 报**编码后**的尺寸而非源图:`kCGImageDestinationImageMaxPixelSize` 在
/// ImageIO 内部降 scale,对输入调 `CGImageGetWidth` 会多报那个倍数(实测
/// 1676x1320 的窗口编成 1280x1008)—— 结果行里的错误尺寸会让模型对着一个
/// 它拿不到的分辨率推理。手工扫描 SOF 而非引图像库:这是唯一会需要依赖
/// 的地方,不可解析时报 (0, 0) 只是装饰性降级,绝非失败。
pub fn jpeg_dimensions(raw: &[u8]) -> (u32, u32) {
	if raw.len() < 4 || raw[0] != JPEG_MARKER || raw[1] != JPEG_SOI {
		return (0, 0);
	}
	let mut pos = 2;
	while pos + 3 < raw.len() {
		if raw[pos] != JPEG_MARKER {
			pos += 1;
			continue;
		}
		let marker = raw[pos + 1];
		if marker == JPEG_MARKER
			|| marker == JPEG_SOI
			|| marker == JPEG_EOI
			|| (JPEG_RST_FIRST..=JPEG_RST_LAST).contains(&marker)
		{
			pos += 2;
			continue;
		}
		if JPEG_SOF_MARKERS.contains(&marker) {
			let start = pos + JPEG_SOF_DIMENSION_OFFSET;
			if start + 4 > raw.len() {
				return (0, 0);
			}
			let height = u16::from_be_bytes([raw[start], raw[start + 1]]);
			let width = u16::from_be_bytes([raw[start + 2], raw[start + 3]]);
			return (u32::from(width), u32::from(height));
		}
		let segment = u16::from_be_bytes([raw[pos + 2], raw[pos + 3]]);
		if segment < 2 {
			return (0, 0);
		}
		pos += 2 + usize::from(segment);
	}
	(0, 0)
}
