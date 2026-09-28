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

/// A hand-built v4 transaction: one transparent input, no outputs, no shielded parts. It parses (a v4 header's
/// bytes 8..12 are not a branch id, so it must never reach the branch check).
#[test]
fn a_v4_transaction_still_parses() {
    let mut v4 = hex::decode("0400008085202f89").unwrap(); // v4, overwintered; the Sapling version group id
    v4.push(1); // one input
    v4.extend([0u8; 36]); // its prevout
    v4.push(0); // an empty script
    v4.extend([0xff; 4]); // its sequence
    v4.push(0); // no outputs
    v4.extend([0u8; 8]); // lock time, expiry height
    v4.extend([0u8; 8]); // value balance
    v4.extend([0u8; 3]); // no spends, outputs or JoinSplits
    parse_transaction(&v4).expect("a v4 transaction parses");
}

/// A v5 header (its own version group id) with NU7's branch: refused by name as the v6 case is.
#[test]
fn a_v5_nu7_transaction_is_refused_by_name() {
    let mut v5 = hex::decode("050000800a27a726").unwrap();
    v5.extend(0x7719_0ad9u32.to_le_bytes());
    v5.extend([0u8; 64]);
    let err = parse_transaction(&v5).expect_err("refused");
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
}

/// Bytes that are not a v5/v6 header stay malformed, never "unsupported branch": a non-overwintered header, a
/// v5 version with another version group id, a txid pasted by mistake (its fourth byte has the overwintered bit),
/// short and empty input.
#[test]
fn garbage_is_malformed_not_an_unknown_branch() {
    let mut not_overwintered = hex::decode("050000000a27a726").unwrap();
    not_overwintered.extend(0x7719_0ad9u32.to_le_bytes());
    not_overwintered.extend([0u8; 64]);
    let mut wrong_group = hex::decode("0500008000000000").unwrap();
    wrong_group.extend(0x7719_0ad9u32.to_le_bytes());
    wrong_group.extend([0u8; 64]);
    let txid =
        hex::decode("58794a9b32a9c051a7e9e44f319c114aabd6bfe2c334a85f0ca7321810c8a011").unwrap();
    let bytes = hex::decode(TX.trim()).unwrap();
    for (name, input) in [
        ("non-overwintered", not_overwintered.as_slice()),
        ("wrong version group id", wrong_group.as_slice()),
        ("a txid", txid.as_slice()),
        ("11 bytes", &bytes[..11]),
        ("empty", &[][..]),
    ] {
        let result = parse_transaction(input);
        assert!(
            matches!(result, Err(CoreError::Malformed(_))),
            "{name}: {:?}",
            result.err()
        );
    }
}

/// A real mainnet v6 transaction whose shielded parts are Orchard and Sapling only (block 3,498,992; slice U2).
const ORCHARD_V6: &str = include_str!(
    "../../../fixtures/368ff5b2a985d39594fd69281bfad0531a7f495d4cb23f443e73d5e1ca93d047.hex"
);

/// Zebra's GHSA-h5rr-8pqv-grp9 (R127): `zcash_primitives` parses a v6 transaction under a pre-NU6.3 branch, whose
/// Orchard bundle the v6 writer refuses. It can never be consensus-valid, so it is refused as malformed (slice U2); the
/// same bytes under NU6.3, as mined, still parse.
#[test]
fn a_v6_transaction_under_a_pre_nu6_3_branch_is_malformed() {
    use zcash_protocol::consensus::BranchId;
    let mined = hex::decode(ORCHARD_V6.trim()).unwrap();
    assert_eq!(
        u32::from_le_bytes(mined[8..12].try_into().unwrap()),
        u32::from(BranchId::Nu6_3)
    );
    let tx = parse_transaction(&mined).expect("the mined transaction parses");
    assert_eq!(
        zeceipt_core::txid_hex(&tx),
        "368ff5b2a985d39594fd69281bfad0531a7f495d4cb23f443e73d5e1ca93d047"
    );
    for branch in [
        BranchId::Nu5,
        BranchId::Nu6,
        BranchId::Nu6_1,
        BranchId::Nu6_2,
    ] {
        let mut bytes = mined.clone();
        bytes[8..12].copy_from_slice(&u32::from(branch).to_le_bytes());
        match parse_transaction(&bytes) {
            Err(CoreError::Malformed(text)) => assert!(
                text.contains("a V6 transaction cannot use consensus branch")
                    && text.contains(&format!("{:#010x}", u32::from(branch))),
                "{branch:?}: {text}"
            ),
            other => panic!(
                "{branch:?}: {:?}",
                other.map(|t| zeceipt_core::txid_hex(&t))
            ),
        }
    }
}
