// Adapted from Point model/instance.go; see ../SOURCE_REFERENCES.md.
package model

// Binding retains only the facts required for resource detachment or destruction.
// Run admission and execution leases belong to the existing Pero coordinator.
type Binding struct {
	ID            string      `json:"id"`
	SlotID        string      `json:"slotId"`
	Observation   Observation `json:"observation"`
	ReleaseIntent string      `json:"releaseIntent"`
}
