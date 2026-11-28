package resourceref

import "testing"

func paper(owner, project, id string) Qualified {
	value, err := Qualify(Local{
		App: "paper-agent", Kind: "paper", ID: id, Revision: PaperDigest, Class: ClassImmutable,
	}, &Binding{
		OwnerHost: owner, SharedProject: project, LocalProject: "local-" + project,
		AppInstance: "paper-agent@" + owner, AppVersion: "1",
	})
	if err != nil {
		panic(err)
	}
	return value
}

func evidence() *Evidence {
	return &Evidence{Digest: PaperDigest, MediaType: "text/plain", Body: []byte(PaperEvidence)}
}

func TestSamePaperEvidenceFromItsOwner(t *testing.T) {
	grants := []Grant{{SharedProject: "lab", App: "paper-agent", ID: "paper-1"}}
	local, err := ReadPaper(ReadInput{
		Resource: paper("local", "lab", "paper-1"), Project: "lab", Member: true, AppEnabled: true,
		Grants: grants, Evidence: evidence(), OwnerAvailable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	remote, err := ReadPaper(ReadInput{
		Resource: paper("host-b", "lab", "paper-1"), Project: "lab", Member: true, AppEnabled: true,
		Grants: grants, Evidence: evidence(), OwnerAvailable: true,
		Cache: &Cache{OwnerHost: "host-b", Revision: PaperDigest, Provenance: DomainProvenance, Digest: PaperDigest, Body: []byte(PaperEvidence)},
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(local.Body) != PaperEvidence || string(remote.Body) != string(local.Body) || remote.Digest != PaperDigest || remote.OwnerHost != "host-b" || remote.Provenance != DomainProvenance {
		t.Fatalf("local %+v remote %+v", local, remote)
	}
	other := paper("host-c", "lab", "paper-1")
	owner, err := Resolve(OpRead, &other, "host-b", true)
	if err != nil || owner != "host-c" {
		t.Fatalf("owner %s err %v", owner, err)
	}
}

func TestResolutionNeverChangesOwner(t *testing.T) {
	existing := paper("host-b", "lab", "paper-1")
	local := paper("local", "lab", "paper-1")
	local.SharedProject = ""
	cases := []struct {
		name      string
		operation string
		existing  *Qualified
		policy    string
		available bool
		owner     string
		err       Error
	}{
		{"missing", OpRead, nil, "", true, "", ErrMissing},
		{"create-policy", OpCreate, nil, "", true, "", ErrMissingPolicy},
		{"create", OpCreate, nil, "host-b", true, "host-b", ""},
		{"device", OpDevice, nil, "host-b", true, "local", ""},
		{"device-existing", OpDevice, &existing, "host-c", false, "local", ""},
		{"unavailable", OpRead, &existing, "host-c", false, "", ErrOwnerUnavailable},
		{"create-down", OpCreate, nil, "host-b", false, "", ErrOwnerUnavailable},
		{"local-without-shared", OpRead, &local, "", true, "local", ""},
	}
	for _, tc := range cases {
		owner, err := Resolve(tc.operation, tc.existing, tc.policy, tc.available)
		var want error
		if tc.err != "" {
			want = tc.err
		}
		if owner != tc.owner || err != want {
			t.Fatalf("%s: owner %s err %v", tc.name, owner, err)
		}
	}
	if _, err := ReadPaper(ReadInput{Resource: local, Project: "lab", Member: true, AppEnabled: true, OwnerAvailable: true}); err != ErrWrongProject {
		t.Fatal(err)
	}
}

func TestPaperReadsFailClosed(t *testing.T) {
	resource := paper("host-b", "lab", "paper-1")
	grants := []Grant{{SharedProject: "lab", App: "paper-agent", ID: "paper-1"}}
	ok := ReadInput{Resource: resource, Project: "lab", Member: true, AppEnabled: true, Grants: grants, Evidence: evidence(), OwnerAvailable: true}
	cases := []struct {
		name string
		edit func(*ReadInput)
		want Error
	}{
		{"revoked", func(in *ReadInput) { in.Member = false }, ErrRevoked},
		{"project", func(in *ReadInput) { in.Project = "other" }, ErrWrongProject},
		{"disabled", func(in *ReadInput) { in.AppEnabled = false }, ErrDisabledApp},
		{"ungranted", func(in *ReadInput) { in.Grants = nil }, ErrUngranted},
		{"unavailable", func(in *ReadInput) { in.OwnerAvailable = false }, ErrOwnerUnavailable},
		{"unwired", func(in *ReadInput) { in.OwnerAvailable = false; in.Grants = nil; in.Evidence = nil }, ErrOwnerUnavailable},
		{"stale", func(in *ReadInput) {
			in.Evidence = &Evidence{Digest: "ab" + ok.Evidence.Digest[2:], MediaType: "text/plain", Body: []byte("other")}
		}, ErrStale},
		{"cache", func(in *ReadInput) {
			in.Cache = &Cache{OwnerHost: "host-c", Revision: PaperDigest, Provenance: DomainProvenance, Digest: PaperDigest, Body: []byte(PaperEvidence)}
		}, ErrStale},
	}
	for _, tc := range cases {
		in := ok
		tc.edit(&in)
		if _, err := ReadPaper(in); err != tc.want {
			t.Fatalf("%s: %v", tc.name, err)
		}
	}
	traversed := resource
	traversed.ID = "../secret"
	if err := traversed.fields(); err != ErrTraversal {
		t.Fatal(err)
	}
	observed := resource
	observed.Class = ClassObserved
	if _, err := ReadPaper(ReadInput{Resource: observed, Project: "lab", Member: true, AppEnabled: true, Grants: grants, Evidence: evidence(), OwnerAvailable: true}); err != ErrNotEvidence {
		t.Fatal(err)
	}
	if _, err := Qualify(Local{App: "paper-agent", Kind: "paper", ID: "paper-1", Revision: PaperDigest, Class: ClassObserved}, nil); err != ErrMissingPolicy {
		t.Fatal(err)
	}
}
