use super::*;
use serde_json::json;

#[test]
fn remote_requests_admit_only_the_fixed_method_and_typed_references() {
    let cluster = json!({"id":"cluster-test","name":"Loopback","host":"loopback","scheduler":"ssh","account":"","partition":"","workdir":"/tmp/pero"});
    for (samples, repetitions, valid) in [
        (1000, 1, true),
        (10000000, 100000, true),
        (999, 1, false),
        (1000, 0, false),
        (10000001, 1, false),
    ] {
        assert_eq!(serde_json::from_value::<Request>(json!({"operation":"prepare","cluster":cluster,"input":{"samples":samples,"repetitions":repetitions}})).is_ok(),valid);
    }
    for request in [
        json!({"operation":"execute","command":"echo no"}),
        json!({"operation":"prepare","cluster":cluster,"input":{"samples":1000,"repetitions":1,"command":"echo no"}}),
        json!({"operation":"submit","id":"../escape","digest":"a".repeat(64)}),
    ] {
        assert!(serde_json::from_value::<Request>(request).is_err());
    }
}
