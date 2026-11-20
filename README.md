# vinhthanh-3d

Không gian tưởng niệm 3D nhiều người cùng vào cho **Nghĩa trang Liệt sĩ xã Vĩnh Thanh**. Chỉ chạy local.
Viết mới bằng Three.js, không dùng lại code hay hình ảnh của trang gxthanhgia.net.

## Chạy

```bash
PATH=~/.nvm/versions/node/v24.22.3/bin:$PATH   # Node >= 22
npm install            # chỉ cài three
npm run import-data    # đọc ../nghiatrangvinhthanh/lib/cemetery-data.ts → data/graves.json
npm start              # http://127.0.0.1:3100  (PORT=..., HOST=0.0.0.0 để máy khác trong LAN vào)
npm run open           # mở bằng Chrome profile riêng có GPU (Chrome chính của máy này rơi về llvmpipe)
```

Kiểm thử:

```bash
npm test               # smoke: tự bật server ở port ngẫu nhiên với thư mục data tạm, thử HTTP + WebSocket
npm run e2e            # cần server đang chạy ở 3100; Chrome headless vào, đi, dâng lễ, chat, chụp ảnh vào e2e-out/
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
| `server/server.mjs` | Server Node không dependency: file tĩnh, `/api/graves`, `/api/memorial`, `/api/session`, WebSocket `/ws` |
| `public/` | `index.html`, `style.css`, `app.js` (toàn bộ cảnh 3D và UI), âm thanh |
| `data/graves.json` | Sinh ra từ `import-data`; **không commit** |
| `data/state.json` | Lễ vật và nhật ký dâng lễ, server tự ghi; **không commit** |
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
