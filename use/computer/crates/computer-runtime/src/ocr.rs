//! Latest OCR frame per conversation, with a single in-flight Vision call.
use crate::error;
use pero_contracts::{computer_runtime::*, computer_use::*};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
    },
    time::Duration,
};

pub enum WindowText {
    Recognized(String),
    NoText,
    Failed,
}
pub type TextRecognizer = fn(&[u8]) -> WindowText;

enum OcrProgress {
    Pending(Receiver<WindowText>),
    Finished(WindowText),
}

impl OcrProgress {
    fn result(&mut self, wait: Duration) -> (ComputerOcrStatus, Option<String>) {
        if let Self::Pending(receiver) = self {
            match receiver.recv_timeout(wait) {
                Ok(text) => *self = Self::Finished(text),
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    *self = Self::Finished(WindowText::Failed)
                }
                Err(mpsc::RecvTimeoutError::Timeout) => return (ComputerOcrStatus::Pending, None),
            }
        }
        match self {
            Self::Finished(WindowText::Recognized(text)) => {
                (ComputerOcrStatus::Ready, Some(text.clone()))
            }
            Self::Finished(WindowText::NoText) => (ComputerOcrStatus::NoText, None),
            Self::Finished(WindowText::Failed) => (ComputerOcrStatus::Failed, None),
            Self::Pending(_) => unreachable!(),
        }
    }
}

#[derive(Default)]
pub(crate) struct WindowOcr {
    busy: Arc<AtomicBool>,
    frames: HashMap<ComputerRef, (ComputerRef, OcrProgress)>,
}

struct OcrSlot(Arc<AtomicBool>);
impl Drop for OcrSlot {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl WindowOcr {
    pub(crate) fn start(
        &mut self,
        thread: &ComputerRef,
        screenshot: &ComputerRef,
        recognize: TextRecognizer,
        bytes: &[u8],
    ) -> (ComputerOcrStatus, Option<String>) {
        if self.busy.swap(true, Ordering::AcqRel) {
            return (ComputerOcrStatus::Busy, None);
        }
        let slot = OcrSlot(self.busy.clone());
        let bytes = bytes.to_vec();
        let (tx, rx) = mpsc::channel();
        let worker = std::thread::Builder::new()
            .name("computer-use-ocr".into())
            .spawn(move || {
                let text = recognize(&bytes);
                drop(slot);
                let _ = tx.send(text);
            });
        let mut progress = if worker.is_ok() {
            OcrProgress::Pending(rx)
        } else {
            OcrProgress::Finished(WindowText::Failed)
        };
        // Preserve inline OCR for warm calls. Cold Vision results remain readable.
        let result = progress.result(Duration::from_secs(4));
        self.frames
            .insert(thread.clone(), (screenshot.clone(), progress));
        result
    }

    pub(crate) fn read(
        &mut self,
        thread: &ComputerRef,
        screenshot_id: ComputerRef,
    ) -> Result<ComputerResponse, ComputerError> {
        let (_, progress) = self
            .frames
            .get_mut(thread)
            .filter(|(id, _)| *id == screenshot_id)
            .ok_or_else(|| {
                error(
                    ComputerErrorCode::StaleObservation,
                    "Use the screenshot ID from this conversation's latest OCR request",
                )
            })?;
        let (ocr_status, recognized_text) = progress.result(Duration::ZERO);
        Ok(ComputerResponse::Ocr {
            screenshot_id,
            ocr_status,
            recognized_text,
        })
    }

    pub(crate) fn stop(&mut self, thread: &ComputerRef) {
        self.frames.remove(thread);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_text_is_retrievable_for_the_original_frame_and_conversation() {
        let thread: ComputerRef = "owner".to_owned().try_into().unwrap();
        let other = "other".to_owned().try_into().unwrap();
        let frame: ComputerRef = "frame".to_owned().try_into().unwrap();
        let (tx, rx) = mpsc::channel();
        let mut ocr = WindowOcr::default();
        ocr.frames
            .insert(thread.clone(), (frame.clone(), OcrProgress::Pending(rx)));

        assert!(ocr.read(&other, frame.clone()).is_err());
        assert!(matches!(
            ocr.read(&thread, frame.clone()).unwrap(),
            ComputerResponse::Ocr {
                ocr_status: ComputerOcrStatus::Pending,
                ..
            }
        ));
        tx.send(WindowText::Recognized("sample".into())).unwrap();
        assert!(matches!(
            ocr.read(&thread, frame.clone()).unwrap(),
            ComputerResponse::Ocr { ocr_status: ComputerOcrStatus::Ready, recognized_text: Some(text), .. }
            if text == "sample"
        ));
        ocr.stop(&thread);
        assert!(ocr.read(&thread, frame).is_err());
    }
}
