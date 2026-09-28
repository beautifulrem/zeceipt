//! A transaction made for a consensus branch this build's Zcash crates do not know is refused by name, not as
//! malformed bytes (slice U1a; R121). NU7 (ZIP 259) keeps the v5/v6 formats but introduces branch `0x77190AD9`,
//! which `zcash_protocol` 0.10.6 does not know. The fixture is a real, consensus-valid v6 regtest transaction whose
//! header's branch id is swapped: exactly what an NU7 transaction's first 12 bytes look like.

use zeceipt_core::{parse_transaction, CoreError};

const TX: &str = include_str!(
    "../../../fixtures/regtest-58794a9b32a9c051a7e9e44f319c114aabd6bfe2c334a85f0ca7321810c8a011.hex"
);

fn with_branch(id: u32) -> Vec<u8> {
    let mut bytes = hex::decode(TX.trim()).unwrap();
    bytes[8..12].copy_from_slice(&id.to_le_bytes());
    bytes
}

#[test]
fn the_unchanged_transaction_parses() {
    let bytes = hex::decode(TX.trim()).unwrap();
    assert_eq!(
        &bytes[..4],
        &[0x06, 0x00, 0x00, 0x80],
        "a v6 (overwintered) header"
    );
    assert_eq!(
        u32::from_le_bytes(bytes[8..12].try_into().unwrap()),
        0x37a5_165b,
        "NU6.3's branch id"
    );
    parse_transaction(&bytes).expect("parses");
}

#[test]
fn an_nu7_transaction_is_refused_by_name() {
    let err = parse_transaction(&with_branch(0x7719_0ad9)).expect_err("refused");
    assert!(
        matches!(
            err,
            CoreError::UnsupportedBranch {
                id: 0x7719_0ad9,
                ..
            }
        ),
        "{err:?}"
    );
    let text = err.to_string();
    assert!(
        text.contains("0x77190ad9")
            && text.contains("NU7, ZIP 259")
            && text.contains("does not support yet"),
        "{text}"
    );
    assert!(
        !text.contains("malformed"),
        "not reported as malformed bytes: {text}"
    );
}

#[test]
fn any_unknown_branch_is_refused_the_same_way() {
    let err = parse_transaction(&with_branch(0x1234_5678)).expect_err("refused");
    assert!(
        matches!(
            err,
            CoreError::UnsupportedBranch {
                id: 0x1234_5678,
                name: ""
            }
        ),
        "{err:?}"
    );
}

#[test]
fn truncated_bytes_are_still_malformed() {
    let bytes = hex::decode(TX.trim()).unwrap();
    assert!(matches!(
        parse_transaction(&bytes[..10]),
        Err(CoreError::Malformed(_))
    ));
    assert!(matches!(
        parse_transaction(&bytes[..200]),
        Err(CoreError::Malformed(_))
    ));
}
