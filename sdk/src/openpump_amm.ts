/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/openpump_amm.json`.
 */
export type OpenpumpAmm = {
  "address": "BQHw8ro8CMRQbRGDWsseCEffKksJZCqUg4K45sjA6eYb",
  "metadata": {
    "name": "openpumpAmm",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "OpenPump constant-product AMM: graduated coins trade here (clean-room, PumpSwap-shaped)"
  },
  "instructions": [
    {
      "name": "adminCtoPool",
      "docs": [
        "Protocol: community takeover of a pool's coin creator (mirrors the curve's admin_cto)."
      ],
      "discriminator": [
        45,
        61,
        165,
        151,
        104,
        0,
        49,
        189
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "globalConfig",
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
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.index",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.creator",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.base_mint",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.quote_mint",
                "account": "pool"
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
          "name": "coinCreator",
          "type": "pubkey"
        },
        {
          "name": "isHolderReward",
          "type": "bool"
        },
        {
          "name": "creatorFeeBps",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "boostBuyAndBurn",
      "docs": [
        "Boost authority: spend vault quote back into the pool and burn the base it buys (price goes up)."
      ],
      "discriminator": [
        105,
        68,
        6,
        175,
        0,
        7,
        35,
        162
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.index",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.creator",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.base_mint",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.quote_mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "globalConfig",
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
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "baseMint",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "poolBaseTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "poolQuoteTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "boostVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  111,
                  115,
                  116,
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
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "boostVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "boostVaultAuthority"
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
          "name": "baseTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
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
          "name": "quoteAmountIn",
          "type": "u64"
        },
        {
          "name": "minBaseAmountBurned",
          "type": "u64"
        }
      ]
    },
    {
      "name": "buy",
      "docs": [
        "Buy an exact amount of base tokens, paying at most `max_quote_amount_in` (fees included).",
        "`track_volume`: count the quote spent toward the shared volume-incentive campaign (SOL pools, both accumulators passed)."
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
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.index",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.creator",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.base_mint",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.quote_mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalConfig",
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
          "name": "baseMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "userBaseTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "baseTokenProgram"
              },
              {
                "kind": "account",
                "path": "baseMint"
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
          "name": "userQuoteTokenAccount",
          "writable": true
        },
        {
          "name": "poolBaseTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "poolQuoteTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "protocolFeeRecipient"
        },
        {
          "name": "protocolFeeRecipientTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "protocolFeeRecipient"
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
          "name": "coinCreatorVaultAuthority",
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
                "path": "pool.coin_creator",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "coinCreatorVaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "coinCreatorVaultAuthority"
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
          "name": "baseTokenProgram"
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
          "name": "feeConfig",
          "docs": [
            "Optional: the fees program's tiered schedule (market-cap based)."
          ],
          "optional": true,
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
            ],
            "program": {
              "kind": "const",
              "value": [
                10,
                50,
                191,
                176,
                155,
                212,
                196,
                247,
                247,
                172,
                197,
                92,
                253,
                33,
                102,
                203,
                247,
                159,
                252,
                203,
                183,
                61,
                58,
                213,
                149,
                62,
                171,
                3,
                137,
                31,
                188,
                106
              ]
            }
          }
        },
        {
          "name": "buybackFeeRecipientTokenAccount",
          "docs": [
            "Optional: quote ATA of `global_config.buyback_fee_recipient`; receives the buyback share of the protocol fee."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "globalVolumeAccumulator",
          "writable": true,
          "optional": true
        },
        {
          "name": "userVolumeAccumulator",
          "writable": true,
          "optional": true
        },
        {
          "name": "volumeTracker",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  45,
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "curveProgram",
          "optional": true,
          "address": "AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB"
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
          "name": "baseAmountOut",
          "type": "u64"
        },
        {
          "name": "maxQuoteAmountIn",
          "type": "u64"
        },
        {
          "name": "trackVolume",
          "type": "bool"
        }
      ]
    },
    {
      "name": "buyExactQuoteIn",
      "docs": [
        "Spend up to `spendable_quote_in` (fees included) for as much base as that buys; at least `min_base_amount_out`."
      ],
      "discriminator": [
        198,
        46,
        21,
        82,
        180,
        217,
        232,
        112
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.index",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.creator",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.base_mint",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.quote_mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalConfig",
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
          "name": "baseMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "userBaseTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "baseTokenProgram"
              },
              {
                "kind": "account",
                "path": "baseMint"
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
          "name": "userQuoteTokenAccount",
          "writable": true
        },
        {
          "name": "poolBaseTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "poolQuoteTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "protocolFeeRecipient"
        },
        {
          "name": "protocolFeeRecipientTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "protocolFeeRecipient"
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
          "name": "coinCreatorVaultAuthority",
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
                "path": "pool.coin_creator",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "coinCreatorVaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "coinCreatorVaultAuthority"
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
          "name": "baseTokenProgram"
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
          "name": "feeConfig",
          "docs": [
            "Optional: the fees program's tiered schedule (market-cap based)."
          ],
          "optional": true,
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
            ],
            "program": {
              "kind": "const",
              "value": [
                10,
                50,
                191,
                176,
                155,
                212,
                196,
                247,
                247,
                172,
                197,
                92,
                253,
                33,
                102,
                203,
                247,
                159,
                252,
                203,
                183,
                61,
                58,
                213,
                149,
                62,
                171,
                3,
                137,
                31,
                188,
                106
              ]
            }
          }
        },
        {
          "name": "buybackFeeRecipientTokenAccount",
          "docs": [
            "Optional: quote ATA of `global_config.buyback_fee_recipient`; receives the buyback share of the protocol fee."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "globalVolumeAccumulator",
          "writable": true,
          "optional": true
        },
        {
          "name": "userVolumeAccumulator",
          "writable": true,
          "optional": true
        },
        {
          "name": "volumeTracker",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  45,
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "curveProgram",
          "optional": true,
          "address": "AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB"
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
          "name": "spendableQuoteIn",
          "type": "u64"
        },
        {
          "name": "minBaseAmountOut",
          "type": "u64"
        },
        {
          "name": "trackVolume",
          "type": "bool"
        }
      ]
    },
    {
      "name": "collectCoinCreatorFee",
      "docs": [
        "The coin creator sweeps everything in their vault for `quote_mint` into their own ATA."
      ],
      "discriminator": [
        160,
        57,
        89,
        42,
        181,
        139,
        43,
        66
      ],
      "accounts": [
        {
          "name": "coinCreator",
          "writable": true,
          "signer": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "coinCreatorVaultAuthority",
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
                "path": "coinCreator"
              }
            ]
          }
        },
        {
          "name": "coinCreatorVaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "coinCreatorVaultAuthority"
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
          "name": "coinCreatorTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "coinCreator"
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
      "args": []
    },
    {
      "name": "createConfig",
      "discriminator": [
        201,
        207,
        243,
        114,
        75,
        111,
        47,
        189
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalConfig",
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
          "name": "lpFeeBasisPoints",
          "type": "u64"
        },
        {
          "name": "protocolFeeBasisPoints",
          "type": "u64"
        },
        {
          "name": "coinCreatorFeeBasisPoints",
          "type": "u64"
        },
        {
          "name": "protocolFeeRecipient",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "createPool",
      "discriminator": [
        233,
        146,
        209,
        142,
        207,
        104,
        64,
        188
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "index"
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "account",
                "path": "baseMint"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ]
          }
        },
        {
          "name": "globalConfig",
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
          "name": "creator",
          "docs": [
            "Owner of the initial liquidity. May be a PDA of another program (the curve) signing via CPI."
          ],
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Pays rent for the new accounts (the curve passes the migrating user here)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "baseMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "lpMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  45,
                  108,
                  112,
                  45,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "userBaseTokenAccount",
          "writable": true
        },
        {
          "name": "userQuoteTokenAccount",
          "writable": true
        },
        {
          "name": "userPoolTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "lpMint"
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
          "name": "lockedLpTokenAccount",
          "docs": [
            "Holds MINIMUM_LIQUIDITY LP forever (owned by the pool PDA, which never signs a burn/transfer of it)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "lpMint"
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
          "name": "poolBaseTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "baseTokenProgram"
              },
              {
                "kind": "account",
                "path": "baseMint"
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
          "name": "poolQuoteTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pool"
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
          "name": "coinCreatorVaultAuthority",
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
                "kind": "arg",
                "path": "coinCreator"
              }
            ]
          }
        },
        {
          "name": "coinCreatorVaultAta",
          "docs": [
            "Created here so buy/sell never need to init accounts."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "coinCreatorVaultAuthority"
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
          "name": "tokenProgram",
          "docs": [
            "Token program for the LP mint (classic SPL Token)."
          ]
        },
        {
          "name": "baseTokenProgram"
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
          "type": "u16"
        },
        {
          "name": "baseAmountIn",
          "type": "u64"
        },
        {
          "name": "quoteAmountIn",
          "type": "u64"
        },
        {
          "name": "coinCreator",
          "type": "pubkey"
        },
        {
          "name": "isHolderReward",
          "type": "bool"
        },
        {
          "name": "creatorFeeBps",
          "type": "u64"
        },
        {
          "name": "canEditCreatorFee",
          "type": "bool"
        }
      ]
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.index",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.creator",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.base_mint",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.quote_mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "globalConfig",
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
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "baseMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "lpMint",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "userBaseTokenAccount",
          "writable": true
        },
        {
          "name": "userQuoteTokenAccount",
          "writable": true
        },
        {
          "name": "userPoolTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "lpMint"
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
          "name": "poolBaseTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "poolQuoteTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "baseTokenProgram"
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
          "name": "lpTokenAmountOut",
          "type": "u64"
        },
        {
          "name": "maxBaseAmountIn",
          "type": "u64"
        },
        {
          "name": "maxQuoteAmountIn",
          "type": "u64"
        }
      ]
    },
    {
      "name": "disable",
      "docs": [
        "Kill switch. Bits: 1 create_pool, 2 deposit, 4 withdraw, 8 buy, 16 sell."
      ],
      "discriminator": [
        185,
        173,
        187,
        90,
        216,
        15,
        238,
        233
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalConfig"
          ]
        },
        {
          "name": "globalConfig",
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
          "name": "disableFlags",
          "type": "u8"
        }
      ]
    },
    {
      "name": "distributeCoinCreatorFees",
      "docs": [
        "Permissionless: split a sharing-config coin creator's vault among its shareholders",
        "(remaining accounts: wallets..., then their quote ATAs...)."
      ],
      "discriminator": [
        104,
        33,
        9,
        101,
        144,
        231,
        147,
        140
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.index",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.creator",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.base_mint",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.quote_mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "sharingConfig",
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
                "path": "pool.base_mint",
                "account": "pool"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                10,
                50,
                191,
                176,
                155,
                212,
                196,
                247,
                247,
                172,
                197,
                92,
                253,
                33,
                102,
                203,
                247,
                159,
                252,
                203,
                183,
                61,
                58,
                213,
                149,
                62,
                171,
                3,
                137,
                31,
                188,
                106
              ]
            }
          }
        },
        {
          "name": "quoteMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "coinCreatorVaultAuthority",
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
            ]
          }
        },
        {
          "name": "coinCreatorVaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "coinCreatorVaultAuthority"
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
          "name": "initializeAta",
          "type": "bool"
        }
      ]
    },
    {
      "name": "extendAccount",
      "docs": [
        "Grow a GlobalConfig / Pool account created by an older program version to the current layout",
        "(new fields read as zero). Permissionless; the payer covers the rent delta."
      ],
      "discriminator": [
        234,
        102,
        194,
        203,
        150,
        72,
        62,
        229
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "account",
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
      "args": []
    },
    {
      "name": "initBoost",
      "docs": [
        "Move part of a freshly migrated pool's quote into its boost vault without moving the price",
        "(the pool keeps counting it as virtual quote). Only migration pools with no LP holders."
      ],
      "discriminator": [
        140,
        233,
        33,
        94,
        132,
        90,
        194,
        143
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.index",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.creator",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.base_mint",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.quote_mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "globalConfig",
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
          "name": "payer",
          "docs": [
            "Pays the vault's rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "quoteMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "lpMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "poolQuoteTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "boostVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  111,
                  115,
                  116,
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
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "boostVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "boostVaultAuthority"
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
      "args": []
    },
    {
      "name": "multiHopSwap",
      "docs": [
        "Route through up to 4 pools in one instruction (see multihop.rs for the remaining-accounts layout)."
      ],
      "discriminator": [
        43,
        100,
        73,
        19,
        233,
        246,
        111,
        148
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "userInTokenAccount",
          "writable": true
        },
        {
          "name": "userOutTokenAccount",
          "writable": true
        },
        {
          "name": "globalConfig",
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
          "name": "feeConfig",
          "optional": true,
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
            ],
            "program": {
              "kind": "const",
              "value": [
                10,
                50,
                191,
                176,
                155,
                212,
                196,
                247,
                247,
                172,
                197,
                92,
                253,
                33,
                102,
                203,
                247,
                159,
                252,
                203,
                183,
                61,
                58,
                213,
                149,
                62,
                171,
                3,
                137,
                31,
                188,
                106
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
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
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minAmountOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sell",
      "docs": [
        "Sell an exact amount of base tokens, receiving at least `min_quote_amount_out` (after fees)."
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
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.index",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.creator",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.base_mint",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.quote_mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "globalConfig",
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
          "name": "baseMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "userBaseTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "baseTokenProgram"
              },
              {
                "kind": "account",
                "path": "baseMint"
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
          "name": "userQuoteTokenAccount",
          "writable": true
        },
        {
          "name": "poolBaseTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "poolQuoteTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "protocolFeeRecipient"
        },
        {
          "name": "protocolFeeRecipientTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "protocolFeeRecipient"
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
          "name": "coinCreatorVaultAuthority",
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
                "path": "pool.coin_creator",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "coinCreatorVaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "coinCreatorVaultAuthority"
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
          "name": "baseTokenProgram"
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
          "name": "feeConfig",
          "docs": [
            "Optional: the fees program's tiered schedule (market-cap based)."
          ],
          "optional": true,
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
            ],
            "program": {
              "kind": "const",
              "value": [
                10,
                50,
                191,
                176,
                155,
                212,
                196,
                247,
                247,
                172,
                197,
                92,
                253,
                33,
                102,
                203,
                247,
                159,
                252,
                203,
                183,
                61,
                58,
                213,
                149,
                62,
                171,
                3,
                137,
                31,
                188,
                106
              ]
            }
          }
        },
        {
          "name": "buybackFeeRecipientTokenAccount",
          "docs": [
            "Optional: quote ATA of `global_config.buyback_fee_recipient`; receives the buyback share of the protocol fee."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "globalVolumeAccumulator",
          "writable": true,
          "optional": true
        },
        {
          "name": "userVolumeAccumulator",
          "writable": true,
          "optional": true
        },
        {
          "name": "volumeTracker",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  45,
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "curveProgram",
          "optional": true,
          "address": "AmSumZo1ko2pXPKCAxp2uZwcFoQrVzNkRFf4w7EEHunB"
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
          "name": "baseAmountIn",
          "type": "u64"
        },
        {
          "name": "minQuoteAmountOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setBoostAuthority",
      "discriminator": [
        227,
        149,
        76,
        42,
        130,
        39,
        234,
        205
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalConfig"
          ]
        },
        {
          "name": "globalConfig",
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
          "name": "newBoostAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setCoinCreator",
      "docs": [
        "The current coin creator hands the fee stream to another address (e.g. a fees-program sharing PDA)."
      ],
      "discriminator": [
        210,
        149,
        128,
        45,
        188,
        58,
        78,
        175
      ],
      "accounts": [
        {
          "name": "coinCreator",
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.index",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.creator",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.base_mint",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.quote_mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "globalConfig",
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
          "name": "newCoinCreator",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setCoinCreatorFeeBps",
      "docs": [
        "Coin creator sets the pool's creator fee (0 = schedule) within the ceiling; `lock` makes it final."
      ],
      "discriminator": [
        66,
        89,
        202,
        237,
        8,
        118,
        158,
        169
      ],
      "accounts": [
        {
          "name": "coinCreator",
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.index",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.creator",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.base_mint",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.quote_mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "globalConfig",
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
          "name": "creatorFeeBps",
          "type": "u64"
        },
        {
          "name": "lock",
          "type": "bool"
        }
      ]
    },
    {
      "name": "toggleBoost",
      "discriminator": [
        117,
        161,
        160,
        74,
        223,
        137,
        118,
        99
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalConfig"
          ]
        },
        {
          "name": "globalConfig",
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
          "name": "enabled",
          "type": "bool"
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
          "name": "admin",
          "signer": true,
          "relations": [
            "globalConfig"
          ]
        },
        {
          "name": "globalConfig",
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
      "name": "updateBoostConfig",
      "docs": [
        "Share of a migration pool's quote (bps) moved into its boost vault by `init_boost`."
      ],
      "discriminator": [
        60,
        36,
        79,
        238,
        182,
        143,
        245,
        1
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalConfig"
          ]
        },
        {
          "name": "globalConfig",
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
          "name": "boostBasisPoints",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateBuybackConfig",
      "docs": [
        "Share of the protocol fee (bps) routed to the buyback recipient's quote ATA on every direct swap."
      ],
      "discriminator": [
        251,
        224,
        171,
        146,
        160,
        26,
        113,
        233
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalConfig"
          ]
        },
        {
          "name": "globalConfig",
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
          "name": "buybackBasisPoints",
          "type": "u64"
        },
        {
          "name": "buybackFeeRecipient",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updateCreatorFeeConfig",
      "discriminator": [
        61,
        175,
        160,
        249,
        66,
        66,
        136,
        175
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "globalConfig"
          ]
        },
        {
          "name": "globalConfig",
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
          "name": "creatorFeeConfigurable",
          "type": "bool"
        },
        {
          "name": "maxConfigurableCreatorFeeBps",
          "type": "u64"
        },
        {
          "name": "adminSetCoinCreatorAuthority",
          "type": "pubkey"
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
          "name": "admin",
          "signer": true,
          "relations": [
            "globalConfig"
          ]
        },
        {
          "name": "globalConfig",
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
          "name": "lpFeeBasisPoints",
          "type": "u64"
        },
        {
          "name": "protocolFeeBasisPoints",
          "type": "u64"
        },
        {
          "name": "coinCreatorFeeBasisPoints",
          "type": "u64"
        },
        {
          "name": "protocolFeeRecipient",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "withdraw",
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
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.index",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.creator",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.base_mint",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.quote_mint",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "globalConfig",
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
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "baseMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "lpMint",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "userBaseTokenAccount",
          "writable": true
        },
        {
          "name": "userQuoteTokenAccount",
          "writable": true
        },
        {
          "name": "userPoolTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "lpMint"
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
          "name": "poolBaseTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "poolQuoteTokenAccount",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "baseTokenProgram"
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
          "name": "lpTokenAmountIn",
          "type": "u64"
        },
        {
          "name": "minBaseAmountOut",
          "type": "u64"
        },
        {
          "name": "minQuoteAmountOut",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
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
      "name": "globalConfig",
      "discriminator": [
        149,
        8,
        156,
        202,
        160,
        252,
        176,
        217
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
    }
  ],
  "events": [
    {
      "name": "adminCtoPoolEvent",
      "discriminator": [
        47,
        35,
        163,
        249,
        150,
        157,
        147,
        122
      ]
    },
    {
      "name": "boostBuyAndBurnEvent",
      "discriminator": [
        63,
        69,
        28,
        22,
        48,
        92,
        194,
        185
      ]
    },
    {
      "name": "boostConfigEvent",
      "discriminator": [
        229,
        41,
        179,
        196,
        150,
        35,
        160,
        113
      ]
    },
    {
      "name": "buyEvent",
      "discriminator": [
        103,
        244,
        82,
        31,
        44,
        245,
        119,
        119
      ]
    },
    {
      "name": "collectCoinCreatorFeeEvent",
      "discriminator": [
        232,
        245,
        194,
        238,
        234,
        218,
        58,
        89
      ]
    },
    {
      "name": "createPoolEvent",
      "discriminator": [
        177,
        49,
        12,
        210,
        160,
        118,
        167,
        116
      ]
    },
    {
      "name": "depositEvent",
      "discriminator": [
        120,
        248,
        61,
        83,
        31,
        142,
        107,
        144
      ]
    },
    {
      "name": "distributeCoinCreatorFeesEvent",
      "discriminator": [
        172,
        215,
        189,
        216,
        79,
        230,
        123,
        56
      ]
    },
    {
      "name": "extendAccountEvent",
      "discriminator": [
        97,
        97,
        215,
        144,
        93,
        146,
        22,
        124
      ]
    },
    {
      "name": "initBoostEvent",
      "discriminator": [
        174,
        124,
        74,
        249,
        4,
        81,
        246,
        17
      ]
    },
    {
      "name": "multiHopSwapEvent",
      "discriminator": [
        234,
        159,
        160,
        154,
        165,
        156,
        255,
        85
      ]
    },
    {
      "name": "sellEvent",
      "discriminator": [
        62,
        47,
        55,
        10,
        165,
        3,
        220,
        42
      ]
    },
    {
      "name": "setCoinCreatorEvent",
      "discriminator": [
        229,
        25,
        185,
        183,
        235,
        88,
        194,
        78
      ]
    },
    {
      "name": "updateBuybackConfigEvent",
      "discriminator": [
        249,
        82,
        149,
        32,
        89,
        203,
        211,
        130
      ]
    },
    {
      "name": "updateConfigEvent",
      "discriminator": [
        96,
        112,
        253,
        102,
        59,
        78,
        75,
        134
      ]
    },
    {
      "name": "withdrawEvent",
      "discriminator": [
        22,
        9,
        133,
        26,
        160,
        44,
        71,
        192
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
      "name": "disabled",
      "msg": "This instruction is disabled"
    },
    {
      "code": 6002,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6003,
      "name": "feeTooHigh",
      "msg": "Fee exceeds the maximum allowed"
    },
    {
      "code": 6004,
      "name": "insufficientLiquidity",
      "msg": "Insufficient liquidity"
    },
    {
      "code": 6005,
      "name": "exceededSlippage",
      "msg": "Slippage limit exceeded"
    },
    {
      "code": 6006,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6007,
      "name": "invalidFeeRecipient",
      "msg": "Invalid protocol fee recipient"
    },
    {
      "code": 6008,
      "name": "sharingNotActive",
      "msg": "Sharing config is not active"
    },
    {
      "code": 6009,
      "name": "sharingMismatch",
      "msg": "Sharing config does not match this pool"
    },
    {
      "code": 6010,
      "name": "recipientsMismatch",
      "msg": "Shareholders and remaining accounts do not match"
    },
    {
      "code": 6011,
      "name": "holderRewardCreatorImmutable",
      "msg": "The creator of a holder-reward pool cannot be changed"
    },
    {
      "code": 6012,
      "name": "creatorFeeNotConfigurable",
      "msg": "Creator fee is not configurable"
    },
    {
      "code": 6013,
      "name": "creatorFeeLocked",
      "msg": "Creator fee is locked for this pool"
    },
    {
      "code": 6014,
      "name": "boostDisabled",
      "msg": "Boost is disabled"
    },
    {
      "code": 6015,
      "name": "alreadyBoosted",
      "msg": "Pool already has a boost in flight"
    },
    {
      "code": 6016,
      "name": "notMigrationPool",
      "msg": "Only migration pools can be boosted"
    },
    {
      "code": 6017,
      "name": "poolHasLiquidityProviders",
      "msg": "Pool has liquidity providers"
    },
    {
      "code": 6018,
      "name": "boostInProgress",
      "msg": "Liquidity is locked while a boost is in flight"
    },
    {
      "code": 6019,
      "name": "nothingToBoost",
      "msg": "Nothing to boost"
    },
    {
      "code": 6020,
      "name": "invalidAccount",
      "msg": "Not an account of this program"
    },
    {
      "code": 6021,
      "name": "alreadyExtended",
      "msg": "Account already has the current layout"
    }
  ],
  "types": [
    {
      "name": "adminCtoPoolEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "oldCoinCreator",
            "type": "pubkey"
          },
          {
            "name": "newCoinCreator",
            "type": "pubkey"
          },
          {
            "name": "isHolderReward",
            "type": "bool"
          },
          {
            "name": "creatorFeeBps",
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
      "name": "boostBuyAndBurnEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "quoteAmountInRequested",
            "type": "u64"
          },
          {
            "name": "quoteAmountInUsed",
            "type": "u64"
          },
          {
            "name": "baseAmountBurned",
            "type": "u64"
          },
          {
            "name": "virtualQuoteReserves",
            "type": "u64"
          },
          {
            "name": "realQuoteReservesAfter",
            "type": "u64"
          },
          {
            "name": "baseReservesAfter",
            "type": "u64"
          },
          {
            "name": "boostVaultRemaining",
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
      "name": "boostConfigEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "boostAuthority",
            "type": "pubkey"
          },
          {
            "name": "oldBoostAuthority",
            "type": "pubkey"
          },
          {
            "name": "boostEnabled",
            "type": "bool"
          },
          {
            "name": "boostBasisPoints",
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
      "name": "buyEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "baseAmountOut",
            "type": "u64"
          },
          {
            "name": "quoteAmountIn",
            "type": "u64"
          },
          {
            "name": "lpFee",
            "type": "u64"
          },
          {
            "name": "protocolFee",
            "type": "u64"
          },
          {
            "name": "coinCreatorFee",
            "type": "u64"
          },
          {
            "name": "quoteAmountInWithFees",
            "type": "u64"
          },
          {
            "name": "poolBaseReserves",
            "type": "u64"
          },
          {
            "name": "poolQuoteReserves",
            "type": "u64"
          },
          {
            "name": "virtualQuoteReserves",
            "type": "u64"
          },
          {
            "name": "buybackFee",
            "type": "u64"
          },
          {
            "name": "trackVolume",
            "type": "bool"
          },
          {
            "name": "coinCreator",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "collectCoinCreatorFeeEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "coinCreator",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
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
      "name": "createPoolEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "coinCreator",
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
            "name": "index",
            "type": "u16"
          },
          {
            "name": "baseAmountIn",
            "type": "u64"
          },
          {
            "name": "quoteAmountIn",
            "type": "u64"
          },
          {
            "name": "lpMinted",
            "type": "u64"
          },
          {
            "name": "isHolderReward",
            "type": "bool"
          },
          {
            "name": "creatorFeeBps",
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
      "name": "depositEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "lpTokenAmountOut",
            "type": "u64"
          },
          {
            "name": "baseAmountIn",
            "type": "u64"
          },
          {
            "name": "quoteAmountIn",
            "type": "u64"
          },
          {
            "name": "poolBaseReserves",
            "type": "u64"
          },
          {
            "name": "poolQuoteReserves",
            "type": "u64"
          },
          {
            "name": "lpSupply",
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
      "name": "distributeCoinCreatorFeesEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "sharingConfig",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "distributed",
            "type": "u64"
          },
          {
            "name": "recipients",
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
      "name": "extendAccountEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "newSize",
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
      "name": "globalConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "lpFeeBasisPoints",
            "type": "u64"
          },
          {
            "name": "protocolFeeBasisPoints",
            "type": "u64"
          },
          {
            "name": "coinCreatorFeeBasisPoints",
            "type": "u64"
          },
          {
            "name": "protocolFeeRecipient",
            "type": "pubkey"
          },
          {
            "name": "disableFlags",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "adminSetCoinCreatorAuthority",
            "type": "pubkey"
          },
          {
            "name": "creatorFeeConfigurable",
            "type": "bool"
          },
          {
            "name": "maxConfigurableCreatorFeeBps",
            "type": "u64"
          },
          {
            "name": "buybackBasisPoints",
            "docs": [
              "Share of the protocol fee (bps) sent to `buyback_fee_recipient`'s quote ATA on direct swaps."
            ],
            "type": "u64"
          },
          {
            "name": "buybackFeeRecipient",
            "type": "pubkey"
          },
          {
            "name": "boostAuthority",
            "docs": [
              "Boost: migration pools park `boost_basis_points` of their quote in a vault the authority spends on buy-and-burns."
            ],
            "type": "pubkey"
          },
          {
            "name": "boostEnabled",
            "type": "bool"
          },
          {
            "name": "boostBasisPoints",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initBoostEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "virtualQuoteReserves",
            "type": "u64"
          },
          {
            "name": "realQuoteReservesAfter",
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
      "name": "multiHopSwapEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "inputMint",
            "type": "pubkey"
          },
          {
            "name": "outputMint",
            "type": "pubkey"
          },
          {
            "name": "amountIn",
            "type": "u64"
          },
          {
            "name": "amountOut",
            "type": "u64"
          },
          {
            "name": "legs",
            "type": "u8"
          },
          {
            "name": "timestamp",
            "type": "i64"
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
      "name": "sellEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "baseAmountIn",
            "type": "u64"
          },
          {
            "name": "quoteAmountOut",
            "type": "u64"
          },
          {
            "name": "lpFee",
            "type": "u64"
          },
          {
            "name": "protocolFee",
            "type": "u64"
          },
          {
            "name": "coinCreatorFee",
            "type": "u64"
          },
          {
            "name": "userQuoteAmountOut",
            "type": "u64"
          },
          {
            "name": "poolBaseReserves",
            "type": "u64"
          },
          {
            "name": "poolQuoteReserves",
            "type": "u64"
          },
          {
            "name": "virtualQuoteReserves",
            "type": "u64"
          },
          {
            "name": "buybackFee",
            "type": "u64"
          },
          {
            "name": "coinCreator",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "setCoinCreatorEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "oldCoinCreator",
            "type": "pubkey"
          },
          {
            "name": "newCoinCreator",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
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
      "name": "updateBuybackConfigEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "buybackBasisPoints",
            "type": "u64"
          },
          {
            "name": "buybackFeeRecipient",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "updateConfigEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "lpFeeBasisPoints",
            "type": "u64"
          },
          {
            "name": "protocolFeeBasisPoints",
            "type": "u64"
          },
          {
            "name": "coinCreatorFeeBasisPoints",
            "type": "u64"
          },
          {
            "name": "protocolFeeRecipient",
            "type": "pubkey"
          },
          {
            "name": "disableFlags",
            "type": "u8"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "withdrawEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "lpTokenAmountIn",
            "type": "u64"
          },
          {
            "name": "baseAmountOut",
            "type": "u64"
          },
          {
            "name": "quoteAmountOut",
            "type": "u64"
          },
          {
            "name": "poolBaseReserves",
            "type": "u64"
          },
          {
            "name": "poolQuoteReserves",
            "type": "u64"
          },
          {
            "name": "lpSupply",
            "type": "u64"
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
