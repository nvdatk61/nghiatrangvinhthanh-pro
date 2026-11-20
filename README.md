# vinhthanh-3d

Không gian tưởng niệm 3D nhiều người cùng vào cho **Nghĩa trang Liệt sĩ xã Vĩnh Thanh**. Chỉ chạy local.
Viết mới bằng Three.js, không dùng lại code hay hình ảnh của trang gxthanhgia.net.

## Chạy

```bash
PATH=~/.nvm/versions/node/v24.22.3/bin:$PATH   # Node >= 22
npm install            # chỉ cài three
npm run import-data    # đọc ../nghiatrangvinhthanh/lib/cemetery-data.ts → data/graves.json + data/graves.sql
npm start              # http://127.0.0.1:3100  (PORT=..., HOST=0.0.0.0 để máy khác trong LAN vào)
npm run open           # mở bằng Chrome profile riêng có GPU (Chrome chính của máy này rơi về llvmpipe)
```

Kiểm thử:

```bash
npm test               # smoke: tự bật server ở port ngẫu nhiên với thư mục data tạm, thử HTTP + WebSocket
npm run e2e            # cần server đang chạy ở 3100; Chrome headless vào, đi, dâng lễ, chat, chụp ảnh vào e2e-out/
```

## Deploy lên Cloudflare (Workers + Durable Objects)

Bản production chạy trên Cloudflare Workers:
- `worker/worker.mjs` phục vụ file tĩnh trong `dist/`, do `npm run build` tạo từ `public/` cộng thêm three.js.
- `/api/*` và `/ws` được chuyển vào một Durable Object tên `MemorialRoom`. Nó dùng chung logic phòng `server/room.mjs` với server Node. Durable Object chỉ giữ phần realtime và phiên người dùng.
- **Dữ liệu bền nằm trong D1**: bảng `graves` và `offerings`, cấu trúc xem `migrations/`. Repo không chứa dữ liệu mộ.
- Bản Node local dùng cùng cấu trúc bảng đó, lưu bằng `node:sqlite` vào file `data/local.db`.

Thiết lập lần đầu, do chủ tài khoản Cloudflare tự chạy:

```bash
npx wrangler login
npx wrangler d1 create vinhthanh-3d                       # dán database_id in ra vào wrangler.jsonc
npx wrangler d1 migrations apply vinhthanh-3d --remote    # tạo bảng
npm run import-data                                       # tạo data/graves.sql từ app nghiatrangvinhthanh
npx wrangler d1 execute vinhthanh-3d --remote --file=data/graves.sql
```

Sau đó vào dashboard Cloudflare, chọn **Workers & Pages → Create → Import a repository** và chọn repo này (Workers Builds).
Mỗi lần merge vào `main`, Cloudflare tự chạy `npx wrangler deploy`.

Sửa dữ liệu mộ: sửa trong app gốc, chạy lại `npm run import-data` rồi `d1 execute --file=data/graves.sql`.
Lệnh này upsert nên không cần deploy lại. Sau khi sửa, Durable Object chỉ đọc lại danh sách mộ khi nó khởi động lại,
mà việc này sẽ xảy ra lúc không còn ai online.

Sao lưu: `npx wrangler d1 export vinhthanh-3d --remote --output=backup.sql`.

Chạy thử Worker trên máy (D1 và Durable Object đều giả lập trong `.wrangler/`):

```bash
npx wrangler d1 migrations apply vinhthanh-3d --local
npx wrangler d1 execute vinhthanh-3d --local --file=data/graves.sql
npm run cf:dev                                  # http://127.0.0.1:8787
node tools/smoke.mjs http://127.0.0.1:8787
```

## Có gì trong cảnh

- Cổng tam quan có câu đối "Đời đời nhớ ơn các anh hùng liệt sĩ", tường bao, hàng cây.
- Đài Tổ quốc ghi công, bàn lễ, lư hương đồng lớn, cột cờ có cờ bay.
- 144 phần mộ dựng theo `row`/`col` trong dữ liệu. Bia có sao đỏ, chữ "LIỆT SĨ", tên, quê, năm sinh, năm hy sinh.
- Thắp hương (có khói), đặt hoa, thắp nến ở từng mộ hoặc ở đài. Lễ vật hiện 24 giờ; tổng số được lưu mãi.
- Thấy người khác đi lại, chat có bong bóng trên đầu, thông báo "X đã thắp hương — liệt sĩ Y".
- Tìm mộ theo tên hoặc quê (gõ không dấu cũng được), bấm vào là đến trước mộ.
- Điều khiển: WASD hoặc mũi tên, Shift để chạy, kéo chuột để xoay, cuộn để zoom, E để viếng mộ gần nhất, Enter để chat. Điện thoại có joystick ảo.

## Cấu trúc

| Đường dẫn | Nội dung |
| --- | --- |
| `server/room.mjs` | Logic phòng dùng chung: người chơi, chat, lễ vật, phiên |
| `server/server.mjs` | Server Node chạy local, không dependency: file tĩnh, `/api/graves`, `/api/memorial`, `/api/session`, WebSocket `/ws` |
| `worker/worker.mjs`, `wrangler.jsonc` | Bản chạy trên Cloudflare (Worker + Durable Object `MemorialRoom`) |
| `public/` | `index.html`, `style.css`, `app.js` (toàn bộ cảnh 3D và UI), âm thanh |
| `migrations/` | Cấu trúc bảng SQLite, dùng chung cho D1 và bản local |
| `server/store.mjs` | Đọc và ghi DB (mộ, lễ vật), dùng chung cho D1 và `node:sqlite` |
| `data/graves.json`, `data/graves.sql` | Sinh ra từ `import-data`; **không commit** |
| `data/local.db` | SQLite của bản Node local (lễ vật, nhật ký); **không commit** |
| `tools/` | `import-data.mjs`, `smoke.mjs`, `e2e.mjs`, `open-chrome.sh` |

## Giao thức WebSocket (JSON, trường `t`)

- client → server: `move{x,z,yaw,moving}`, `chat{text}`, `offer{graveId|"monument", kind: incense|flower|candle}`, `ping`
- server → client: `welcome{id,players,messages,memorial,feed}`, `players{players}` (10 lần/giây khi có thay đổi), `leave{id}`,
  `chat{message}`, `memorial{state,entry}`, `error{message}`
- Mỗi người chỉ dâng cùng một loại lễ ở cùng một mộ sau mỗi 30 giây. Toạ độ bị kẹp trong ±60 m. Mỗi phiên chỉ giữ một kết nối (tab mới thay tab cũ, mã đóng 4001).

## Bố cục toạ độ

Trong `public/app.js`, đầu file: `graveX(col)`, `graveZ(row)`, `MONUMENT_Z`, `URN_Z`, `GATE_Z`.
Hàng 3 gần đài nhất, các hàng lùi dần về phía bắc. Ở giữa cột 12 và 13 có lối đi chính.
Bia quay về phía cổng (+z).
