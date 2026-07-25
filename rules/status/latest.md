# Optimized rule status

Generated: 2026-07-25T03:34:40.590Z

| Provider | Policy | Domain | IP CIDR | Residual | Process | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| custom-direct | DIRECT | 15 | 0 | 1 | 6 | 22 |
| apple-ai | 其他 AI 服务 | 13 | 0 | 0 | 0 | 13 |
| openai | OpenAI | 42 | 2 | 2 | 0 | 46 |
| gemini | Gemini | 42 | 0 | 3 | 0 | 45 |
| claude | Claude | 9 | 0 | 0 | 0 | 9 |
| copilot | 其他 AI 服务 | 52 | 2 | 3 | 0 | 57 |
| tiktok | TikTok | 53 | 0 | 2 | 1 | 56 |
| telegram | Telegram | 27 | 18 | 6 | 6 | 57 |
| youtube | YouTube | 181 | 3 | 1 | 0 | 185 |
| netflix | Netflix | 33 | 1213 | 4 | 1 | 1251 |
| global-media | 国际媒体 | 1312 | 924 | 26 | 3 | 2265 |
| google-fcm | 谷歌FCM | 21 | 26 | 0 | 0 | 47 |
| github | 节点选择 | 68 | 0 | 1 | 0 | 69 |
| bing | 微软Bing | 3 | 0 | 0 | 0 | 3 |
| onedrive | 微软服务 | 16 | 0 | 3 | 2 | 21 |
| microsoft | 微软服务 | 664 | 0 | 4 | 2 | 670 |
| **Total** |  | **2551** | **2188** | **56** | **21** | **4816** |

## MetaCubeX candidate differences

| Provider | Candidate | Mode | Added | Missing from candidate |
| --- | --- | --- | ---: | ---: |
| apple-ai | meta-apple-intelligence | audit | 0 | 8 |
| openai | meta-openai | union | 11 | 20 |
| gemini | meta-google-gemini | union | 32 | 2 |
| claude | meta-anthropic | union | 5 | 1 |
| copilot | meta-github-copilot | union | 6 | 46 |
| tiktok | meta-tiktok | union | 24 | 16 |
| telegram | meta-telegram-domain | union | 3 | 6 |
| telegram | meta-telegram-ip | union | 8 | 6 |
| youtube | meta-youtube | union | 2 | 3 |
| netflix | meta-netflix-domain | union | 0 | 9 |
| netflix | meta-netflix-ip | union | 94 | 1105 |
| google-fcm | meta-google-fcm | union | 3 | 9 |
| github | meta-github | union | 38 | 5 |
| bing | meta-bing | audit | 38 | 0 |
| onedrive | meta-onedrive | union | 3 | 0 |
| microsoft | meta-microsoft | audit | 217 | 135 |
