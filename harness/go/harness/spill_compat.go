package harness

import harnesstool "github.com/phodal/pero/harness/go/tool"

const (
	DefaultSpillMaxInlineBytes = harnesstool.DefaultSpillMaxInlineBytes
	DefaultProcessSpillBytes   = harnesstool.DefaultProcessSpillBytes
	DefaultSessionSpillBytes   = harnesstool.DefaultSessionSpillBytes
	DefaultSpillRetention      = harnesstool.DefaultSpillRetention
)

var ErrSpillQuota = harnesstool.ErrSpillQuota

type SpillOwner = harnesstool.SpillOwner
type SpillSource = harnesstool.SpillSource
type SaveTextSpill = harnesstool.SaveTextSpill
type SpillRef = harnesstool.SpillRef
type SpillStore = harnesstool.SpillStore
type SpillStoreLifecycle = harnesstool.SpillStoreLifecycle
type SpillTextReader = harnesstool.SpillTextReader
type SpillTextRead = harnesstool.SpillTextRead
type SpillTextLookup = harnesstool.SpillTextLookup
type SpillPolicyOptions = harnesstool.SpillPolicyOptions
type SpillPolicyConfig = harnesstool.SpillPolicyConfig
type LocalSpillStoreOptions = harnesstool.LocalSpillStoreOptions
type LocalSpillStore = harnesstool.LocalSpillStore
type ProcessSpill = harnesstool.ProcessSpill
type ProcessSpillStore = harnesstool.ProcessSpillStore

func ValidateSpillPolicyConfig(config SpillPolicyConfig) error {
	return harnesstool.ValidateSpillPolicyConfig(config)
}

func ResolveSpillPolicyConfig(config SpillPolicyConfig) (SpillPolicyConfig, error) {
	return harnesstool.ResolveSpillPolicyConfig(config)
}

func NewLocalSpillStore(root string) *LocalSpillStore {
	return harnesstool.NewLocalSpillStore(root)
}

func NewLocalSpillStoreWithOptions(options LocalSpillStoreOptions) *LocalSpillStore {
	return harnesstool.NewLocalSpillStoreWithOptions(options)
}
