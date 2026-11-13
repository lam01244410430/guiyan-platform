# Python AI service — contract (phase 8: chỉ contract, không code)

Phase 7 mới viết code thật. File này là contract mà service Python phải thỏa
để thay thế trial agent hiện tại; Node backend (`server/routes/assistant.mjs`)
không đổi — nó chỉ gọi `AI_CHAT_URL`.

## Tham chiếu hiện tại (trial agent, GCP my-llm)

- Trial agent chạy ngoài repo (FastAPI + LangGraph ReAct + DeepSeek, nginx :80 → app :5000).
- Đã verify live: `POST /api/chat` `{message, language}` → `{reply}` (2026-11-11;
  kiểm lại 2026-11-13: `{"message":"hi","language":"en"}` → 200, reply chào bằng tiếng Anh).
- Trial agent KHÔNG có `GET /health` (404) — `/health` dưới đây là yêu cầu mới
  cho phase 7 (dùng cho compose healthcheck khi bật profile), không phải hành vi
  hiện tại của trial agent.

## Endpoints bắt buộc

- `POST /api/chat` — request JSON `{message: string, language?: "zh" | "vi" | "en"}`
  (`language` mặc định `"zh"`); response 200 `{reply: string}`.
  - `message` là câu hỏi của user, tối đa ~2000 ký tự.
  - `reply` trả bằng đúng ngôn ngữ `language` yêu cầu.
- `GET /health` — response 200 `{"ok": true}` (không yêu cầu auth).

## Hành vi bắt buộc

- Trả lời ngắn, plain text + bold + bullet list; KHÔNG dùng Markdown table
  (B-022 — tốn token, chỉ Q&A cơ bản).
- Giá vé CHỈ lấy từ catalog live (`GET /api/resources`, qua tool tra cứu giá,
  cache 60s) — không bao giờ bịa giá.
- Không khẳng định thanh toán/đặt vé là thật — hệ thống vẫn là mô phỏng.
- Không log nội dung message của user; không lộ API key trong log/error response.
- Lỗi upstream (LLM timeout/lỗi) → trả 200 với reply fallback ngắn gọn, hoặc 5xx
  sạch (không stack trace); proxy Node fail-open về rule engine nên service lỗi
  không bao giờ làm hỏng request của user.

## Môi trường

- Bắt buộc: `DEEPSEEK_API_KEY` — chỉ qua env, KHÔNG BAO GIỜ commit vào repo
  hay bake vào image.
- Tùy chọn: `DEEPSEEK_MODEL`, timeouts, RAG/Chroma URL (tham chiếu: trial agent
  dùng Chroma collection `deepseek_knowledge`).

## Đóng gói (phase 7)

- Image base đề xuất: `python:3.12-slim` (TBD — kiểm chứng khi phase 7).
- Compose: service `ai` dưới profile `ai` (mặc định KHÔNG chạy); port nội bộ
  5000, không publish; khi bật profile, đặt `AI_CHAT_URL=http://ai:5000/api/chat`
  trong `.env` (file `.env` root, gitignored).
- Phase 8 chưa có Dockerfile trong `python-ai/` — profile tắt nên compose không
  build nó.
