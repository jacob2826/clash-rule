# Optimized rule status

Generated: 2026-08-14T02:43:06.929Z

| Provider | Policy | Domain | IP CIDR | Residual | Process | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| custom-direct | DIRECT | 16 | 0 | 1 | 6 | 23 |
| apple-ai | 其他 AI 服务 | 13 | 0 | 0 | 0 | 13 |
| openai | OpenAI | 22 | 0 | 0 | 0 | 22 |
| gemini | Gemini | 41 | 0 | 0 | 0 | 41 |
| claude | Claude | 8 | 0 | 0 | 0 | 8 |
| copilot | 其他 AI 服务 | 6 | 0 | 0 | 0 | 6 |
| tiktok | TikTok | 36 | 0 | 0 | 0 | 36 |
| telegram | Telegram | 21 | 12 | 0 | 0 | 33 |
| youtube | YouTube | 178 | 0 | 0 | 0 | 178 |
| netflix | Netflix | 24 | 114 | 0 | 0 | 138 |
| google-fcm | 谷歌FCM | 21 | 26 | 0 | 0 | 47 |
| github | 节点选择 | 64 | 0 | 0 | 0 | 64 |
| bing | 微软Bing | 3 | 0 | 0 | 0 | 3 |
| onedrive | 微软服务 | 16 | 0 | 0 | 0 | 16 |
| microsoft | 微软服务 | 747 | 0 | 0 | 0 | 747 |
| **Total** |  | **1216** | **152** | **1** | **6** | **1375** |

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
- Rules: 116304
