package session

// HistorySnapshot returns detached durable history and its current surface from
// one read boundary. Consumers must not combine independent Events/SurfaceSeqs
// reads when deciding whether a published context remains visible.
func (s *Session) HistorySnapshot() ([]Event, []uint64) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneEvents(s.events), append([]uint64(nil), s.surface...)
}

// SurfaceDelta returns new visible events and the complete current surface at
// one read boundary. Consumers retain immutable decoded events still on that
// surface. Events never reenter a surface under an old sequence number.
func (s *Session) SurfaceDelta(after uint64) (events []Event, surface []uint64, last uint64) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	surface = append([]uint64(nil), s.surface...)
	last = uint64(len(s.events))
	for _, seq := range surface {
		if seq > after {
			events = append(events, s.events[seq-1].Clone())
		}
	}
	return
}

// EventAt returns a detached immutable receipt without copying the transcript.
func (s *Session) EventAt(seq uint64) (Event, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if seq == 0 || seq > uint64(len(s.events)) {
		return Event{}, false
	}
	return s.events[seq-1].Clone(), true
}
