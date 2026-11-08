# Optimized rule status

Generated: 2026-11-08T05:55:19.615Z

| Provider | Policy | Domain | IP CIDR | Residual | Process | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| custom-direct | DIRECT | 16 | 0 | 1 | 6 | 23 |
| apple-ai | 其他 AI 服务 | 13 | 0 | 0 | 0 | 13 |
| openai | OpenAI | 24 | 0 | 0 | 0 | 24 |
| gemini | Gemini | 49 | 0 | 0 | 0 | 49 |
| claude | Claude | 21 | 0 | 0 | 0 | 21 |
| copilot | 其他 AI 服务 | 7 | 0 | 0 | 0 | 7 |
| tiktok | TikTok | 40 | 0 | 0 | 0 | 40 |
| telegram | Telegram | 21 | 12 | 0 | 0 | 33 |
| youtube | YouTube | 178 | 0 | 0 | 0 | 178 |
| netflix | Netflix | 24 | 122 | 0 | 0 | 146 |
| google-fcm | 谷歌FCM | 21 | 26 | 0 | 0 | 47 |
| github | 节点选择 | 66 | 0 | 0 | 0 | 66 |
| bing | 微软Bing | 3 | 0 | 0 | 0 | 3 |
| onedrive | 微软服务 | 16 | 0 | 0 | 0 | 16 |
| microsoft | 微软服务 | 754 | 0 | 0 | 0 | 754 |
| **Total** |  | **1253** | **160** | **1** | **6** | **1420** |

## MetaCubeX candidate differences

| Provider | Candidate | Mode | Added | Missing from candidate |
| --- | --- | --- | ---: | ---: |
| apple-ai | meta-apple-intelligence | audit | 0 | 8 |
| google-fcm | meta-google-fcm | union | 3 | 9 |
| bing | meta-bing | audit | 38 | 0 |

## Shadowrocket

- Template: `Shadowrocket.template.conf`
- Provider lists: 15
- GEOSITE lists: 10
- Rules: 115250
