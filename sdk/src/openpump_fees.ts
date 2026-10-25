/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/openpump_fees.json`.
 */
export type OpenpumpFees = {
  "address": "goxedqtEDBUXsuMxYDpgfivPGZuQD4ifzfcFkhVCUe5",
  "metadata": {
    "name": "openpumpFees",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "OpenPump fees program: tiered fee schedule, creator fee sharing, social/donation fee PDAs, buyback vaults"
  },
  "instructions": [
    {
      "name": "adminCtoSharingConfig",
      "docs": [
        "Protocol authority: reset or pause a sharing config (community takeover of abandoned coins)."
      ],
      "discriminator": [
        60,
        100,
        144,
        156,
        64,
        138,
        182,
        37
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "feeProgramGlobal"
          ]
        },
        {
          "name": "feeProgramGlobal",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "sharingConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  105,
                  110,
                  103,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "sharing_config.mint",
                "account": "sharingConfig"
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
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "claimSocialFeePda",
      "docs": [
        "The social-claim authority (after verifying the social login off-chain) pays the PDA's SOL",
        "to the user's wallet. Rate limited per PDA."
      ],
      "discriminator": [
        225,
        21,
        251,
        133,
        161,
        30,
        199,
        226
      ],
      "accounts": [
        {
          "name": "socialClaimAuthority",
          "signer": true,
          "relations": [
            "feeProgramGlobal"
          ]
        },
        {
          "name": "feeProgramGlobal",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "socialFeePda",
          "writable": true
        },
        {
          "name": "recipient",
          "writable": true
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
          "name": "userId",
          "type": "string"
        },
        {
          "name": "platform",
          "type": "u8"
        }
      ]
    },
    {
      "name": "claimSocialFeePdaV2",
      "docs": [
        "Same for a custom-pair quote token held in the PDA's ATA."
      ],
      "discriminator": [
        17,
        77,
        240,
        134,
        58,
        188,
        53,
        149
      ],
      "accounts": [
        {
          "name": "socialClaimAuthority",
          "writable": true,
          "signer": true,
          "relations": [
            "feeProgramGlobal"
          ]
        },
        {
          "name": "feeProgramGlobal",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "socialFeePda",
          "writable": true
        },
        {
          "name": "recipient"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "socialFeePdaQuote",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "socialFeePda"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
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
          "name": "recipientQuote",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "recipient"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
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
          "name": "quoteTokenProgram"
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
          "name": "userId",
          "type": "string"
        },
        {
          "name": "platform",
          "type": "u8"
        }
      ]
    },
    {
      "name": "crankDonationFeePda",
      "docs": [
        "Permissionless: forward everything the PDA holds (SOL above rent) to the beneficiary."
      ],
      "discriminator": [
        220,
        10,
        189,
        167,
        169,
        17,
        25,
        69
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "feeProgramGlobal",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "donationFeePda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  111,
                  110,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  102,
                  101,
                  101,
                  45,
                  112,
                  100,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "donation_fee_pda.base_mint",
                "account": "donationFeePda"
              },
              {
                "kind": "account",
                "path": "donation_fee_pda.beneficiary",
                "account": "donationFeePda"
              }
            ]
          }
        },
        {
          "name": "beneficiary",
          "writable": true,
          "relations": [
            "donationFeePda"
          ]
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
      "name": "createDonationFeePda",
      "docs": [
        "A creator routes their coin's creator fee to `beneficiary` (set the coin's creator to this PDA",
        "via the curve's `set_creator`; the PDA address is deterministic from mint + beneficiary)."
      ],
      "discriminator": [
        244,
        139,
        16,
        88,
        14,
        255,
        122,
        26
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "feeProgramGlobal",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "baseMint",
          "docs": [
            "can name it as creator."
          ]
        },
        {
          "name": "beneficiary"
        },
        {
          "name": "donationFeePda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  111,
                  110,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  102,
                  101,
                  101,
                  45,
                  112,
                  100,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "baseMint"
              },
              {
                "kind": "account",
                "path": "beneficiary"
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
      "name": "createFeeSharingConfig",
      "docs": [
        "The coin's creator turns their creator fee into a shared stream. Reassigns the coin's creator",
        "(curve, and the AMM pool if graduated) to this SharingConfig PDA; starts with 100 % to the creator."
      ],
      "discriminator": [
        195,
        78,
        86,
        76,
        111,
        52,
        251,
        213
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Must be the coin's current creator."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "feeProgramGlobal",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
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
          "name": "sharingConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  105,
                  110,
                  103,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "curveProgram",
          "address": "AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB"
        },
        {
          "name": "curveEventAuthority"
        },
        {
          "name": "pool",
          "docs": [
            "Graduated coins: the migration pool, so the AMM-side creator is reassigned as well."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "ammProgram",
          "optional": true,
          "address": "BQHw8ro8CMRQbRGDWsseCEffKksJZCqUg4K45sjA6eYb"
        },
        {
          "name": "ammEventAuthority",
          "optional": true
        },
        {
          "name": "ammGlobalConfig",
          "optional": true
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
      "name": "createSocialFeePda",
      "discriminator": [
        144,
        224,
        59,
        211,
        78,
        248,
        202,
        220
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "feeProgramGlobal",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "socialFeePda",
          "writable": true
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
          "name": "userId",
          "type": "string"
        },
        {
          "name": "platform",
          "type": "u8"
        }
      ]
    },
    {
      "name": "getFees",
      "docs": [
        "View: fees for a trade (returned through return data)."
      ],
      "discriminator": [
        231,
        37,
        126,
        85,
        207,
        91,
        63,
        52
      ],
      "accounts": [
        {
          "name": "feeConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "isNativePool",
          "type": "bool"
        },
        {
          "name": "marketCapLamports",
          "type": "u128"
        },
        {
          "name": "quoteMint",
          "type": "pubkey"
        }
      ],
      "returns": {
        "defined": {
          "name": "fees"
        }
      }
    },
    {
      "name": "initializeBuyback",
      "discriminator": [
        250,
        129,
        236,
        160,
        227,
        36,
        103,
        134
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "feeProgramGlobal"
          ]
        },
        {
          "name": "feeProgramGlobal",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "buybackVault",
          "writable": true
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
          "name": "index",
          "type": "u8"
        },
        {
          "name": "authority",
          "type": "pubkey"
        },
        {
          "name": "claimRateLimit",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initializeFeeConfig",
      "discriminator": [
        62,
        162,
        20,
        133,
        121,
        65,
        145,
        27
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "feeProgramGlobal"
          ]
        },
        {
          "name": "feeProgramGlobal",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "feeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "flatFees",
          "type": {
            "defined": {
              "name": "fees"
            }
          }
        },
        {
          "name": "feeTiers",
          "type": {
            "vec": {
              "defined": {
                "name": "feeTier"
              }
            }
          }
        }
      ]
    },
    {
      "name": "initializeFeeProgramGlobal",
      "discriminator": [
        35,
        215,
        130,
        84,
        233,
        56,
        124,
        167
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "feeProgramGlobal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
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
          "name": "socialClaimAuthority",
          "type": "pubkey"
        },
        {
          "name": "disableFlags",
          "type": "u8"
        },
        {
          "name": "claimRateLimit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "revokeFeeSharingAuthority",
      "docs": [
        "Lock the split forever."
      ],
      "discriminator": [
        18,
        233,
        158,
        39,
        185,
        207,
        58,
        104
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "sharingConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  105,
                  110,
                  103,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "sharing_config.mint",
                "account": "sharingConfig"
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
      "name": "setAuthority",
      "discriminator": [
        133,
        250,
        37,
        21,
        110,
        163,
        26,
        121
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "feeProgramGlobal"
          ]
        },
        {
          "name": "feeProgramGlobal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
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
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setClaimRateLimit",
      "discriminator": [
        185,
        211,
        159,
        174,
        212,
        49,
        88,
        4
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "feeProgramGlobal"
          ]
        },
        {
          "name": "feeProgramGlobal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
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
          "name": "claimRateLimit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setDisableFlags",
      "discriminator": [
        194,
        217,
        112,
        35,
        114,
        222,
        51,
        190
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "feeProgramGlobal"
          ]
        },
        {
          "name": "feeProgramGlobal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
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
          "name": "disableFlags",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setExoticFlatFees",
      "discriminator": [
        30,
        234,
        149,
        138,
        252,
        230,
        39,
        73
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "feeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "exoticFlatFees",
          "type": {
            "defined": {
              "name": "fees"
            }
          }
        }
      ]
    },
    {
      "name": "setSocialClaimAuthority",
      "discriminator": [
        147,
        54,
        184,
        154,
        136,
        237,
        185,
        153
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "feeProgramGlobal"
          ]
        },
        {
          "name": "feeProgramGlobal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
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
          "name": "socialClaimAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "sweepBuyback",
      "docs": [
        "The buyback authority takes the accrued SOL to execute buybacks (rate limited)."
      ],
      "discriminator": [
        138,
        33,
        204,
        38,
        207,
        161,
        159,
        226
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "buybackVault"
          ]
        },
        {
          "name": "buybackVault",
          "writable": true
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
          "name": "index",
          "type": "u8"
        }
      ]
    },
    {
      "name": "sweepBuybackQuote",
      "docs": [
        "The buyback authority takes the quote tokens (AMM buyback share, e.g. WSOL) accrued in the vault's ATA."
      ],
      "discriminator": [
        234,
        118,
        61,
        145,
        160,
        233,
        233,
        114
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "buybackVault"
          ]
        },
        {
          "name": "buybackVault",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "vaultQuote",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "buybackVault"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
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
          "name": "authorityQuote",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
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
          "name": "quoteTokenProgram"
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
          "name": "index",
          "type": "u8"
        }
      ]
    },
    {
      "name": "transferFeeSharingAuthority",
      "discriminator": [
        202,
        10,
        75,
        200,
        164,
        34,
        210,
        96
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "sharingConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  105,
                  110,
                  103,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "sharing_config.mint",
                "account": "sharingConfig"
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
          "name": "authority",
          "signer": true
        },
        {
          "name": "feeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
      "name": "updateBuybackAuthority",
      "discriminator": [
        66,
        98,
        113,
        202,
        121,
        37,
        219,
        107
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "feeProgramGlobal"
          ]
        },
        {
          "name": "feeProgramGlobal",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "buybackVault",
          "writable": true
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
          "name": "index",
          "type": "u8"
        },
        {
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updateBuybackClaimRateLimit",
      "discriminator": [
        186,
        95,
        135,
        190,
        255,
        199,
        137,
        170
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "feeProgramGlobal"
          ]
        },
        {
          "name": "feeProgramGlobal",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "buybackVault",
          "writable": true
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
          "name": "index",
          "type": "u8"
        },
        {
          "name": "claimRateLimit",
          "type": "i64"
        }
      ]
    },
    {
      "name": "updateFeeConfig",
      "discriminator": [
        104,
        184,
        103,
        242,
        88,
        151,
        107,
        20
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "feeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "feeTiers",
          "type": {
            "vec": {
              "defined": {
                "name": "feeTier"
              }
            }
          }
        },
        {
          "name": "flatFees",
          "type": {
            "defined": {
              "name": "fees"
            }
          }
        }
      ]
    },
    {
      "name": "updateFeeShares",
      "docs": [
        "Admin sets a new split. Pending fees are paid to the *previous* shareholders first by the",
        "caller (client does `distribute_creator_fees` in the same transaction); on-chain we only",
        "require the vault to be empty so nobody's accrued share is re-split."
      ],
      "discriminator": [
        189,
        13,
        136,
        99,
        187,
        164,
        237,
        35
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "mint",
          "relations": [
            "sharingConfig"
          ]
        },
        {
          "name": "sharingConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  105,
                  110,
                  103,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "creatorVault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sharingConfig"
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
          "name": "shareholders",
          "type": {
            "vec": {
              "defined": {
                "name": "shareholder"
              }
            }
          }
        }
      ]
    },
    {
      "name": "updateStableFeeConfig",
      "discriminator": [
        107,
        169,
        100,
        179,
        134,
        155,
        146,
        221
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "feeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "feeTiers",
          "type": {
            "vec": {
              "defined": {
                "name": "feeTier"
              }
            }
          }
        },
        {
          "name": "stableMints",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "upsertFeeTiers",
      "docs": [
        "Replace tiers starting at `offset` (pump's upsert semantics)."
      ],
      "discriminator": [
        227,
        23,
        150,
        12,
        77,
        86,
        94,
        4
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "feeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "feeTiers",
          "type": {
            "vec": {
              "defined": {
                "name": "feeTier"
              }
            }
          }
        },
        {
          "name": "offset",
          "type": "u8"
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "Authority withdraws stray SOL sent to the fee config PDA."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "feeProgramGlobal"
          ]
        },
        {
          "name": "feeProgramGlobal",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  45,
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "feeConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
      "name": "buybackVault",
      "discriminator": [
        153,
        166,
        71,
        144,
        179,
        189,
        137,
        251
      ]
    },
    {
      "name": "donationFeePda",
      "discriminator": [
        246,
        197,
        96,
        9,
        193,
        30,
        93,
        115
      ]
    },
    {
      "name": "feeConfig",
      "discriminator": [
        143,
        52,
        146,
        187,
        219,
        123,
        76,
        155
      ]
    },
    {
      "name": "feeProgramGlobal",
      "discriminator": [
        162,
        165,
        245,
        49,
        29,
        37,
        55,
        242
      ]
    },
    {
      "name": "pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    },
    {
      "name": "sharingConfig",
      "discriminator": [
        216,
        74,
        9,
        0,
        56,
        140,
        93,
        75
      ]
    },
    {
      "name": "socialFeePda",
      "discriminator": [
        139,
        96,
        53,
        17,
        42,
        169,
        206,
        150
      ]
    }
  ],
  "events": [
    {
      "name": "createFeeSharingConfigEvent",
      "discriminator": [
        133,
        105,
        170,
        200,
        184,
        116,
        251,
        88
      ]
    },
    {
      "name": "donationFeePdaCranked",
      "discriminator": [
        30,
        208,
        107,
        93,
        177,
        0,
        223,
        78
      ]
    },
    {
      "name": "donationFeePdaCreated",
      "discriminator": [
        94,
        20,
        137,
        239,
        35,
        77,
        225,
        235
      ]
    },
    {
      "name": "initializeFeeProgramGlobalEvent",
      "discriminator": [
        40,
        233,
        156,
        78,
        95,
        0,
        8,
        199
      ]
    },
    {
      "name": "resetFeeSharingConfigEvent",
      "discriminator": [
        203,
        204,
        151,
        226,
        120,
        55,
        214,
        243
      ]
    },
    {
      "name": "setAuthorityEvent",
      "discriminator": [
        18,
        175,
        132,
        66,
        208,
        201,
        87,
        242
      ]
    },
    {
      "name": "setClaimRateLimitEvent",
      "discriminator": [
        13,
        143,
        143,
        235,
        181,
        19,
        51,
        40
      ]
    },
    {
      "name": "setDisableFlagsEvent",
      "discriminator": [
        5,
        8,
        179,
        65,
        49,
        55,
        145,
        126
      ]
    },
    {
      "name": "setExoticFlatFeesEvent",
      "discriminator": [
        195,
        138,
        108,
        15,
        8,
        77,
        68,
        9
      ]
    },
    {
      "name": "setSocialClaimAuthorityEvent",
      "discriminator": [
        60,
        118,
        127,
        132,
        239,
        52,
        254,
        14
      ]
    },
    {
      "name": "socialFeePdaClaimed",
      "discriminator": [
        50,
        18,
        193,
        65,
        237,
        210,
        234,
        236
      ]
    },
    {
      "name": "socialFeePdaCreated",
      "discriminator": [
        183,
        183,
        218,
        147,
        24,
        124,
        137,
        169
      ]
    },
    {
      "name": "sweepBuybackEvent",
      "discriminator": [
        43,
        56,
        42,
        214,
        153,
        57,
        166,
        137
      ]
    },
    {
      "name": "sweepBuybackQuoteEvent",
      "discriminator": [
        153,
        109,
        52,
        30,
        152,
        156,
        44,
        175
      ]
    },
    {
      "name": "updateFeeConfigEvent",
      "discriminator": [
        90,
        23,
        65,
        35,
        62,
        244,
        188,
        208
      ]
    },
    {
      "name": "updateFeeSharesEvent",
      "discriminator": [
        21,
        186,
        196,
        184,
        91,
        228,
        225,
        203
      ]
    },
    {
      "name": "updateStableFeeConfigEvent",
      "discriminator": [
        94,
        5,
        43,
        237,
        103,
        147,
        232,
        245
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notAuthorized",
      "msg": "Not authorized"
    },
    {
      "code": 6001,
      "name": "featureDeactivated",
      "msg": "Feature deactivated"
    },
    {
      "code": 6002,
      "name": "feeTooHigh",
      "msg": "Fee exceeds the maximum allowed"
    },
    {
      "code": 6003,
      "name": "tooManyTiers",
      "msg": "Too many tiers / entries"
    },
    {
      "code": 6004,
      "name": "tiersNotSorted",
      "msg": "Tiers must be sorted ascending by threshold"
    },
    {
      "code": 6005,
      "name": "invalidTierOffset",
      "msg": "Invalid tier offset"
    },
    {
      "code": 6006,
      "name": "invalidShares",
      "msg": "Invalid shareholders (1-10, unique, >0, sum 10000)"
    },
    {
      "code": 6007,
      "name": "adminRevoked",
      "msg": "Sharing config admin revoked"
    },
    {
      "code": 6008,
      "name": "notActive",
      "msg": "Sharing config not active"
    },
    {
      "code": 6009,
      "name": "alreadyExists",
      "msg": "Already exists"
    },
    {
      "code": 6010,
      "name": "holderRewardCoin",
      "msg": "Holder-reward coins cannot share creator fees"
    },
    {
      "code": 6011,
      "name": "vaultNotEmpty",
      "msg": "Distribute pending fees before changing the split"
    },
    {
      "code": 6012,
      "name": "userIdTooLong",
      "msg": "user_id must be 1-32 bytes"
    },
    {
      "code": 6013,
      "name": "rateLimited",
      "msg": "Rate limited"
    },
    {
      "code": 6014,
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
          }
        ]
      }
    },
    {
      "name": "buybackVault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "totalClaimed",
            "type": "u64"
          },
          {
            "name": "lastClaimed",
            "type": "i64"
          },
          {
            "name": "claimRateLimit",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "configStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "paused"
          },
          {
            "name": "active"
          }
        ]
      }
    },
    {
      "name": "createFeeSharingConfigEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "sharingConfig",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "initialShareholders",
            "type": {
              "vec": {
                "defined": {
                  "name": "shareholder"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "donationFeePda",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "beneficiary",
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "totalDonated",
            "type": "u64"
          },
          {
            "name": "lastCrankTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "donationFeePdaCranked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "signer",
            "type": "pubkey"
          },
          {
            "name": "donationFeePda",
            "type": "pubkey"
          },
          {
            "name": "beneficiary",
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "donationFeePdaCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "createdBy",
            "type": "pubkey"
          },
          {
            "name": "donationFeePda",
            "type": "pubkey"
          },
          {
            "name": "beneficiary",
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "feeConfig",
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
            "name": "flatFees",
            "docs": [
              "Used when no tier applies / for foreign pools."
            ],
            "type": {
              "defined": {
                "name": "fees"
              }
            }
          },
          {
            "name": "feeTiers",
            "docs": [
              "SOL-quoted coins (sorted ascending by threshold)."
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "feeTier"
                }
              }
            }
          },
          {
            "name": "stableFeeTiers",
            "docs": [
              "Coins quoted in a stable mint listed in `stable_mints`."
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "feeTier"
                }
              }
            }
          },
          {
            "name": "exoticFlatFees",
            "docs": [
              "Any other quote mint (custom pairs)."
            ],
            "type": {
              "defined": {
                "name": "fees"
              }
            }
          },
          {
            "name": "stableMints",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "feeProgramGlobal",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "disableFlags",
            "type": "u8"
          },
          {
            "name": "socialClaimAuthority",
            "type": "pubkey"
          },
          {
            "name": "claimRateLimit",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "feeTier",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketCapLamportsThreshold",
            "docs": [
              "Market cap (in quote base units, i.e. lamports for SOL) from which this tier applies."
            ],
            "type": "u128"
          },
          {
            "name": "fees",
            "type": {
              "defined": {
                "name": "fees"
              }
            }
          }
        ]
      }
    },
    {
      "name": "fees",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lpFeeBps",
            "type": "u64"
          },
          {
            "name": "protocolFeeBps",
            "type": "u64"
          },
          {
            "name": "creatorFeeBps",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initializeFeeProgramGlobalEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "socialClaimAuthority",
            "type": "pubkey"
          },
          {
            "name": "disableFlags",
            "type": "u8"
          },
          {
            "name": "claimRateLimit",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "index",
            "type": "u16"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "lpMint",
            "type": "pubkey"
          },
          {
            "name": "poolBaseTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "poolQuoteTokenAccount",
            "type": "pubkey"
          },
          {
            "name": "lpSupply",
            "type": "u64"
          },
          {
            "name": "coinCreator",
            "type": "pubkey"
          },
          {
            "name": "protocolFees",
            "docs": [
              "Lifetime stats (informational)."
            ],
            "type": "u64"
          },
          {
            "name": "creatorFees",
            "type": "u64"
          },
          {
            "name": "isHolderReward",
            "type": "bool"
          },
          {
            "name": "creatorFeeBps",
            "docs": [
              "Per-pool creator fee override (bps). 0 = follow the schedule."
            ],
            "type": "u64"
          },
          {
            "name": "canEditCreatorFee",
            "type": "bool"
          },
          {
            "name": "virtualQuoteReserves",
            "docs": [
              "Quote parked in the boost vault but still priced as if in the pool (see boost.rs)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "resetFeeSharingConfigEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "sharingConfig",
            "type": "pubkey"
          },
          {
            "name": "oldAdmin",
            "type": "pubkey"
          },
          {
            "name": "oldShareholders",
            "type": {
              "vec": {
                "defined": {
                  "name": "shareholder"
                }
              }
            }
          },
          {
            "name": "newAdmin",
            "type": "pubkey"
          },
          {
            "name": "newShareholders",
            "type": {
              "vec": {
                "defined": {
                  "name": "shareholder"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "setAuthorityEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "oldAuthority",
            "type": "pubkey"
          },
          {
            "name": "newAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "setClaimRateLimitEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "claimRateLimit",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "setDisableFlagsEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "disableFlags",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "setExoticFlatFeesEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "feeConfig",
            "type": "pubkey"
          },
          {
            "name": "exoticFlatFees",
            "type": {
              "defined": {
                "name": "fees"
              }
            }
          }
        ]
      }
    },
    {
      "name": "setSocialClaimAuthorityEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "socialClaimAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "shareholder",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "address",
            "type": "pubkey"
          },
          {
            "name": "shareBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "sharingConfig",
      "docs": [
        "Per-coin creator fee split. When a coin's `creator` is this PDA, its creator fees accrue in the",
        "PDA's creator vault and `distribute_creator_fees` (curve / AMM) pays the shareholders."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "configStatus"
              }
            }
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "adminRevoked",
            "type": "bool"
          },
          {
            "name": "shareholders",
            "type": {
              "vec": {
                "defined": {
                  "name": "shareholder"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "socialFeePda",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "userId",
            "type": "string"
          },
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "totalClaimed",
            "type": "u64"
          },
          {
            "name": "lastClaimed",
            "type": "u64"
          },
          {
            "name": "totalStableClaimed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "socialFeePdaClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "userId",
            "type": "string"
          },
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "socialFeePda",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "lifetimeClaimed",
            "type": "u64"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "socialFeePdaCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "userId",
            "type": "string"
          },
          {
            "name": "platform",
            "type": "u8"
          },
          {
            "name": "socialFeePda",
            "type": "pubkey"
          },
          {
            "name": "createdBy",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "sweepBuybackEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalClaimed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "sweepBuybackQuoteEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "updateFeeConfigEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "feeConfig",
            "type": "pubkey"
          },
          {
            "name": "flatFees",
            "type": {
              "defined": {
                "name": "fees"
              }
            }
          },
          {
            "name": "feeTiers",
            "type": {
              "vec": {
                "defined": {
                  "name": "feeTier"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "updateFeeSharesEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "sharingConfig",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "newShareholders",
            "type": {
              "vec": {
                "defined": {
                  "name": "shareholder"
                }
              }
            }
          },
          {
            "name": "version",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "updateStableFeeConfigEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "feeConfig",
            "type": "pubkey"
          },
          {
            "name": "feeTiers",
            "type": {
              "vec": {
                "defined": {
                  "name": "feeTier"
                }
              }
            }
          }
        ]
      }
    }
  ]
};
