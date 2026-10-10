# Optimized rule status

Generated: 2026-10-10T05:46:14.787Z

| Provider | Policy | Domain | IP CIDR | Residual | Process | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| custom-direct | DIRECT | 16 | 0 | 1 | 6 | 23 |
| apple-ai | 其他 AI 服务 | 13 | 0 | 0 | 0 | 13 |
| openai | OpenAI | 22 | 0 | 0 | 0 | 22 |
| gemini | Gemini | 46 | 0 | 0 | 0 | 46 |
| claude | Claude | 9 | 0 | 0 | 0 | 9 |
| copilot | 其他 AI 服务 | 6 | 0 | 0 | 0 | 6 |
| tiktok | TikTok | 37 | 0 | 0 | 0 | 37 |
| telegram | Telegram | 21 | 12 | 0 | 0 | 33 |
| youtube | YouTube | 178 | 0 | 0 | 0 | 178 |
| netflix | Netflix | 24 | 122 | 0 | 0 | 146 |
| google-fcm | 谷歌FCM | 21 | 26 | 0 | 0 | 47 |
| github | 节点选择 | 65 | 0 | 0 | 0 | 65 |
| bing | 微软Bing | 3 | 0 | 0 | 0 | 3 |
| onedrive | 微软服务 | 16 | 0 | 0 | 0 | 16 |
| microsoft | 微软服务 | 747 | 0 | 0 | 0 | 747 |
| **Total** |  | **1224** | **160** | **1** | **6** | **1391** |

## MetaCubeX candidate differences

| Provider | Candidate | Mode | Added | Missing from candidate |
| --- | --- | --- | ---: | ---: |
| apple-ai | meta-apple-intelligence | audit | 0 | 8 |
| google-fcm | meta-google-fcm | union | 3 | 9 |
| bing | meta-bing | audit | 37 | 0 |

## Shadowrocket

- Template: `Shadowrocket.template.conf`
- Provider lists: 15
- GEOSITE lists: 10
- Rules: 116643
