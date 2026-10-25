/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/openpump_mayhem.json`.
 */
export type OpenpumpMayhem = {
  "address": "Bh6Tz6WwwQbxEAMB2FjkrLWjAXbAxDn3t445jU1pZMAP",
  "metadata": {
    "name": "openpumpMayhem",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "OpenPump Mayhem: protocol market-making vault that buys, sells and burns mayhem-mode coins through the curve"
  },
  "instructions": [
    {
      "name": "burnTokens",
      "docs": [
        "After the deadline anyone can burn what the vault still holds of the coin."
      ],
      "discriminator": [
        76,
        15,
        51,
        254,
        229,
        215,
        121,
        66
      ],
      "accounts": [
        {
          "name": "mayhemState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  121,
                  104,
                  101,
                  109,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true,
          "relations": [
            "mayhemState"
          ]
        },
        {
          "name": "mayhemTokenVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "solVault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "solVault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  108,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "buy",
      "docs": [
        "Trader buys `sol_amount` of the coin from the vault, only if the curve's spot price is within",
        "`tolerance_bps` of `reference` (lamports/token × 1e9) and the amount is under the sweep cap."
      ],
      "discriminator": [
        102,
        6,
        61,
        18,
        1,
        218,
        235,
        234
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true,
          "relations": [
            "globalParams"
          ]
        },
        {
          "name": "globalParams",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "mayhemState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  121,
                  104,
                  101,
                  109,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "mayhemState",
            "bondingCurve"
          ]
        },
        {
          "name": "solVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  108,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mayhemTokenVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "solVault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "curveProgram",
          "address": "AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB"
        },
        {
          "name": "global"
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "bondingCurve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100,
                  105,
                  110,
                  103,
                  45,
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                145,
                28,
                8,
                195,
                246,
                1,
                238,
                183,
                51,
                100,
                19,
                150,
                103,
                225,
                42,
                113,
                120,
                216,
                94,
                158,
                84,
                181,
                96,
                78,
                19,
                245,
                47,
                39,
                11,
                77,
                126,
                124
              ]
            }
          }
        },
        {
          "name": "associatedBondingCurve",
          "writable": true
        },
        {
          "name": "creatorVault",
          "writable": true
        },
        {
          "name": "feeConfig",
          "optional": true
        },
        {
          "name": "buybackFeeRecipient",
          "writable": true,
          "optional": true
        },
        {
          "name": "curveEventAuthority"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "solAmount",
          "type": "u64"
        },
        {
          "name": "reference",
          "type": "u128"
        },
        {
          "name": "toleranceBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initState",
      "docs": [
        "Register a mayhem-mode coin (its curve must carry `is_mayhem_mode`). Called right after launch."
      ],
      "discriminator": [
        124,
        213,
        73,
        136,
        80,
        37,
        141,
        54
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalParams",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "bondingCurve"
          ]
        },
        {
          "name": "bondingCurve",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100,
                  105,
                  110,
                  103,
                  45,
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                145,
                28,
                8,
                195,
                246,
                1,
                238,
                183,
                51,
                100,
                19,
                150,
                103,
                225,
                42,
                113,
                120,
                216,
                94,
                158,
                84,
                181,
                96,
                78,
                19,
                245,
                47,
                39,
                11,
                77,
                126,
                124
              ]
            }
          }
        },
        {
          "name": "mayhemState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  121,
                  104,
                  101,
                  109,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "initializeGlobalParams",
      "discriminator": [
        13,
        18,
        127,
        234,
        59,
        40,
        204,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalParams",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "trader",
          "type": "pubkey"
        },
        {
          "name": "feeRecipient",
          "type": "pubkey"
        },
        {
          "name": "maxSolPerSweep",
          "type": "u64"
        },
        {
          "name": "mayhemDurationSeconds",
          "type": "i64"
        }
      ]
    },
    {
      "name": "resetSolDeployed",
      "discriminator": [
        176,
        173,
        157,
        162,
        240,
        188,
        196,
        57
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalParams"
          ]
        },
        {
          "name": "globalParams",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "resumeTrading",
      "discriminator": [
        146,
        46,
        212,
        86,
        69,
        159,
        30,
        65
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalParams"
          ]
        },
        {
          "name": "globalParams",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "sell",
      "docs": [
        "Trader sells `token_amount` from the vault within the price tolerance. `retained_reserve_bps`",
        "caps the SOL taken out at that share of the curve's real reserves (never drains a curve)."
      ],
      "discriminator": [
        51,
        230,
        133,
        164,
        1,
        127,
        131,
        173
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true,
          "relations": [
            "globalParams"
          ]
        },
        {
          "name": "globalParams",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "mayhemState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  121,
                  104,
                  101,
                  109,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "mayhemState",
            "bondingCurve"
          ]
        },
        {
          "name": "solVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  108,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mayhemTokenVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "solVault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "curveProgram",
          "address": "AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB"
        },
        {
          "name": "global"
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "bondingCurve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100,
                  105,
                  110,
                  103,
                  45,
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                145,
                28,
                8,
                195,
                246,
                1,
                238,
                183,
                51,
                100,
                19,
                150,
                103,
                225,
                42,
                113,
                120,
                216,
                94,
                158,
                84,
                181,
                96,
                78,
                19,
                245,
                47,
                39,
                11,
                77,
                126,
                124
              ]
            }
          }
        },
        {
          "name": "associatedBondingCurve",
          "writable": true
        },
        {
          "name": "creatorVault",
          "writable": true
        },
        {
          "name": "feeConfig",
          "optional": true
        },
        {
          "name": "buybackFeeRecipient",
          "writable": true,
          "optional": true
        },
        {
          "name": "curveEventAuthority"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "tokenAmount",
          "type": "u64"
        },
        {
          "name": "reference",
          "type": "u128"
        },
        {
          "name": "toleranceBps",
          "type": "u16"
        },
        {
          "name": "retainedReserveBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "stopTrading",
      "discriminator": [
        127,
        176,
        106,
        59,
        242,
        122,
        114,
        111
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalParams"
          ]
        },
        {
          "name": "globalParams",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "sweepFees",
      "docs": [
        "Realised profit (vault SOL above what is still deployed + rent) goes to the fee recipient."
      ],
      "discriminator": [
        175,
        225,
        98,
        71,
        118,
        66,
        34,
        148
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "globalParams",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "solVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  108,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "feeRecipient",
          "writable": true,
          "relations": [
            "globalParams"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "updateAdmin",
      "discriminator": [
        161,
        176,
        40,
        213,
        60,
        184,
        179,
        228
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalParams"
          ]
        },
        {
          "name": "globalParams",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updateGlobalParams",
      "discriminator": [
        146,
        36,
        222,
        108,
        89,
        226,
        249,
        126
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalParams"
          ]
        },
        {
          "name": "globalParams",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "mayhemDurationSeconds",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "feeRecipient",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "updateMaxSolPerSweep",
      "discriminator": [
        34,
        173,
        167,
        5,
        200,
        133,
        225,
        146
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalParams"
          ]
        },
        {
          "name": "globalParams",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "value",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateTrader",
      "discriminator": [
        201,
        207,
        99,
        64,
        101,
        86,
        175,
        96
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalParams"
          ]
        },
        {
          "name": "globalParams",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "newTrader",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "withdrawAdmin",
      "docs": [
        "Admin takes SOL out of the vault."
      ],
      "discriminator": [
        30,
        27,
        135,
        188,
        137,
        158,
        218,
        107
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "globalParams"
          ]
        },
        {
          "name": "globalParams",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "solVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  108,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawQuoteAdmin",
      "docs": [
        "Admin takes a token out of the vault (e.g. unsold coin after a campaign)."
      ],
      "discriminator": [
        204,
        113,
        42,
        48,
        114,
        58,
        248,
        89
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "globalParams"
          ]
        },
        {
          "name": "globalParams",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "solVault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  108,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "solVault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "adminTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "admin"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "bondingCurve",
      "discriminator": [
        23,
        183,
        248,
        55,
        96,
        216,
        172,
        96
      ]
    },
    {
      "name": "globalParams",
      "discriminator": [
        121,
        193,
        248,
        87,
        195,
        56,
        76,
        11
      ]
    },
    {
      "name": "mayhemState",
      "discriminator": [
        177,
        253,
        191,
        125,
        203,
        22,
        134,
        107
      ]
    }
  ],
  "events": [
    {
      "name": "burnEvent",
      "discriminator": [
        33,
        89,
        47,
        117,
        82,
        124,
        238,
        250
      ]
    },
    {
      "name": "globalParamsUpdateEvent",
      "discriminator": [
        51,
        100,
        207,
        126,
        188,
        216,
        191,
        136
      ]
    },
    {
      "name": "mayhemStateInitEvent",
      "discriminator": [
        43,
        197,
        211,
        115,
        182,
        228,
        214,
        115
      ]
    },
    {
      "name": "mayhemTradeEvent",
      "discriminator": [
        49,
        72,
        123,
        45,
        110,
        64,
        176,
        133
      ]
    },
    {
      "name": "sweepEvent",
      "discriminator": [
        112,
        81,
        56,
        216,
        105,
        243,
        34,
        221
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6001,
      "name": "tradingPaused",
      "msg": "Trading is paused"
    },
    {
      "code": 6002,
      "name": "notMayhemCoin",
      "msg": "Not a mayhem-mode coin"
    },
    {
      "code": 6003,
      "name": "mayhemEnded",
      "msg": "Mayhem period has ended"
    },
    {
      "code": 6004,
      "name": "mayhemNotEnded",
      "msg": "Mayhem period has not ended"
    },
    {
      "code": 6005,
      "name": "sweepCapExceeded",
      "msg": "Sweep cap exceeded"
    },
    {
      "code": 6006,
      "name": "priceOutOfRange",
      "msg": "Spot price outside the reference tolerance"
    },
    {
      "code": 6007,
      "name": "retainedReserve",
      "msg": "Sell would take more than the retained reserve allows"
    },
    {
      "code": 6008,
      "name": "invalidParams",
      "msg": "Invalid parameters"
    },
    {
      "code": 6009,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6010,
      "name": "insufficientVault",
      "msg": "Insufficient vault balance"
    },
    {
      "code": 6011,
      "name": "nothingToSweep",
      "msg": "Nothing to sweep"
    }
  ],
  "types": [
    {
      "name": "bondingCurve",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "virtualTokenReserves",
            "type": "u64"
          },
          {
            "name": "virtualSolReserves",
            "type": "u64"
          },
          {
            "name": "realTokenReserves",
            "type": "u64"
          },
          {
            "name": "realSolReserves",
            "type": "u64"
          },
          {
            "name": "tokenTotalSupply",
            "type": "u64"
          },
          {
            "name": "complete",
            "type": "bool"
          },
          {
            "name": "migrated",
            "type": "bool"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "creatorFeesTotal",
            "type": "u64"
          },
          {
            "name": "protocolFeesTotal",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "quoteMint",
            "docs": [
              "Pubkey::default() = native SOL curve; otherwise the SPL/Token-2022 quote mint (v2 family)."
            ],
            "type": "pubkey"
          },
          {
            "name": "isHolderReward",
            "docs": [
              "If set, `creator` is the [\"holder-rewards\", mint] PDA and the creator fee is paid out to holders."
            ],
            "type": "bool"
          },
          {
            "name": "creatorFeeBps",
            "docs": [
              "Per-coin creator fee override (bps). 0 = follow the fee schedule."
            ],
            "type": "u64"
          },
          {
            "name": "canEditCreatorFee",
            "type": "bool"
          },
          {
            "name": "isMayhemMode",
            "docs": [
              "Launched in mayhem mode: the mayhem vault trades it until its deadline, then burns."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "burnEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "globalParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "solDeployed",
            "docs": [
              "Net SOL currently deployed across all mayhem coins (lamports, signed so sells can overshoot)."
            ],
            "type": "i128"
          },
          {
            "name": "maxSolPerSweep",
            "type": "u64"
          },
          {
            "name": "mayhemDurationSeconds",
            "type": "i64"
          },
          {
            "name": "version",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "globalParamsUpdateEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "maxSolPerSweep",
            "type": "u64"
          },
          {
            "name": "mayhemDurationSeconds",
            "type": "i64"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "mayhemState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "endTimestamp",
            "type": "i64"
          },
          {
            "name": "solDeployed",
            "type": "i128"
          },
          {
            "name": "tokenNet",
            "type": "i128"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "mayhemStatus"
              }
            }
          },
          {
            "name": "burnedAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "mayhemStateInitEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "endTimestamp",
            "type": "i64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "mayhemStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "ended"
          }
        ]
      }
    },
    {
      "name": "mayhemTradeEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "solAmount",
            "type": "u64"
          },
          {
            "name": "reference",
            "type": "u128"
          },
          {
            "name": "toleranceBps",
            "type": "u16"
          },
          {
            "name": "solVaultBalance",
            "type": "u64"
          },
          {
            "name": "stateSolDeployed",
            "type": "i128"
          },
          {
            "name": "globalSolDeployed",
            "type": "i128"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "sweepEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
