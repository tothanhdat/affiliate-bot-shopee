# Zalo adapter — DM, group, chào mừng, kết bạn, reaction, roster

> Đọc khi sửa `src/adapters/zalo/bot.ts` hoặc `src/adapters/telegram/bot.ts`. Gotcha của `zca-js` nằm riêng ở `src/adapters/zalo/CLAUDE.md`.

## zalo/bot.ts

**bot.ts** — dieu khien 1 TAI KHOAN ZALO CA NHAN qua thu vien khong chinh thuc `zca-js` (mo phong Zalo Web) — KHONG phai Zalo OA. Trong GROUP: xu ly link giong het Telegram adapter (dung chung replyText.ts). Trong DM: lenh "xemhh" tra link dashboard, **link san pham duoc xu ly y het trong group** (2026-09-10, feedback that tu user cuoi: nhieu nguoi ngai gui link trong group vi so thanh vien khac biet minh mua gi - group va DM dung CHUNG method processProductLinks(), khac nhau DUY NHAT o ham sendReply truyen vao: group kem mention @ten, DM van ban thuan vi mention khong co y nghia trong DM; DM chao mung lan dau van gui nhu luong group), moi noi dung KHAC (khong phai "xemhh", khong chua link san pham) IM LANG hoan toan, khong tra loi gi ca - KHONG gui ca USAGE_TEXT (quyet dinh goc 2026-08-17; 2026-08-20 tung doi sang tra loi 1 cau huong dan co dinh de tranh nguoi dung lan dau tuong bot loi, nhung 2026-08-21 doi lai ve im lang hoan toan theo yeu cau truc tiep cua user — ZALO_DM_HELP_TEXT da bi xoa khoi code, dung tim lai). sendDirectMessage(userId, message) (2026-08-20): gui DM chu dong toi 1 userId bat ky (khong phai tra loi message nhan duoc), dung boi notifyUser trong index.ts. Group cung tu dong DM chao mung (formatWelcomeReply) toi user vua gui link san pham DAU TIEN (2026-08-20, yeu cau truc tiep cua user) — LedgerStore.tryClaimWelcomeMessage() (bang welcome_messages moi) dam bao CHI gui 1 lan duy nhat/user, best-effort (loi gui khong chan xu ly link). formatWelcomeReply tu 2026-09-07 hien THANG link dashboard (tao qua findOrCreateDashboardToken) thay vi chi huong dan nhan "xemhh" (van con nhung chi con la cach lay LAI link neu lo mat) - CUNG NGAY sau do rut gon lai lan 2 (yeu cau truc tiep cua user, thay 2 DM chao lien tiep qua dai dong): bo doan "cach dung"/luu y Shopee/link So tay (da co o GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT ben duoi, DM chao truoc do), CHI con tap trung % hoa hong + dashboard link, xung "em" dong bo cac template khac.

**CHI lam cho Zalo, KHONG lam Telegram** — Telegram Bot API chan bot chu dong DM user chua tung tu nhan tin cho bot truoc ("Forbidden: bot can't initiate conversation"), dung target cua tinh nang nay (user MOI, rat co the chua tung DM bot) se loi ngay nen quyet dinh khong lam o Telegram thay vi gui 1 tinh nang loi thau am tham.

## DM chào mừng khi có thành viên mới join group

Ngoai ra, tu 2026-09-07 (yeu cau truc tiep cua user - user moi vao group truoc do khong biet cach dung, phai nhan tin hoi rieng): bot con lang nghe event `group_event` cua zca-js, loai `GroupEventType.JOIN`, va DM chao mung NGAY LUC co thanh vien moi duoc ADD vao group (formatGroupJoinWelcomeReply, tone ngan gon/GenZ, kem link So tay hoan tien, KHONG kem dashboard) - ghi nhan DU actor la CHINH bot hay NGUOI KHAC trong group add vao (yeu cau truc tiep cua user), CHI bo qua dung 1 truong hop: phan tu trong `updateMembers` trung uid cua CHINH bot (qua `api.getOwnId()`) - do la luc bot tu duoc them vao 1 group khac, khong phai khach moi.

**Bat buoc `new Zalo({ selfListen: true })` luc khoi tao** (KHONG phai qua `login()`) - mac dinh thu vien tu nuot am tham moi `group_event` co `event.isSelf === true`, ma co nay dung true CA KHI chinh tai khoan bot la actor thuc hien hanh dong (rat pho bien vi tai khoan bot thuong cung la tai khoan ca nhan chu bot dung de tu quan ly group) - **TUYET DOI KHONG dung `event.isSelf` de loc ca event**, se bo sot dung truong hop nay (phat hien 2026-09-07 tu test that, xem chi tiet trong `src/adapters/zalo/CLAUDE.md`). Claim-once qua LedgerStore.tryClaimGroupJoinMessage() (bang group_join_messages RIENG voi welcome_messages, vi khac trigger). Day la 2 DM chao mung DOC LAP nhau (join group vs gui link dau tien) - cung 1 user co the nhan CA HAI, khong phai 1 cai thay the cai kia.

## Khi DM chào mừng bị chặn

(2026-09-24, yeu cau truc tiep cua user sau su co that tren instance sanhoantien2: user "To Diem" join group nhung khong nhan duoc DM nao - log cho thay Zalo tu choi voi message "...nguoi nay chan khong nhan tin nhan tu nguoi la", rat nhieu nguoi bat cai dat nay nen KHONG phai edge case)

**DM chao mung group-join bi chan -> greetBlockedUserInGroup()**: chao bu NGAY TRONG GROUP kem mention @ten bam duoc (template `groupJoinBlockedReplyTemplate`, placeholder `{{name}}` duoc thay bang chuoi "@ten" roi tinh `pos` qua indexOf - nen template TUYET DOI khong tu them dau "@").

**KHONG con gui loi moi ket ban o nhanh nay tu 2026-10-01** - da chuyen len `sendFriendRequestBestEffort()` chay cho MOI nguoi moi (xem ngay duoi), gui lai o day la gui doi, co test chan. CHI chay khi dung loi bi chan, nhan dien qua `isStrangerBlockedError(message, code)` - loi DM khac (mang/timeout) giu nguyen hanh vi cu la IM LANG, vi noi "ban dang chan tin nhan cua em" khi that ra chi la loi mang thi con te hon khong noi gi.

**Zalo dung IT NHAT 2 BIEN THE thong bao cho CUNG tinh huong nay** (su co thu hai 2026-10-01, instance sanhoantien: 3 nguoi join group bang link nhom, log nhan DU 3 group_event join nhung 2 nguoi cuoi bi `code=127` "Khong the nhan tin nhan tu ban." - text khong co "nguoi la" nen ban cu tra false, ca nhanh chao bu LAN gui loi moi ket ban deu khong chay, 2 user im lang hoan toan): nhan dien gio di qua MA SO `127` truoc roi moi lui ve danh sach cum tu da biet (`"nguoi la"`, `"khong the nhan tin nhan"`) - **dung quay lai khop dung 1 chuoi**, co test chan. Claim-once van tinh 1 lan nhu cu: DM that bai VAN an claim, khong thu lai lan 2.

## Lời mời kết bạn cho mọi thành viên mới

(2026-10-01, yeu cau truc tiep cua user)

**Loi moi ket ban gui cho MOI thanh vien moi join group**, khong chi khi DM bi tu choi nhu truoc: `sendFriendRequestBestEffort()` chay trong `maybeSendGroupJoinWelcome` NGAY TRUOC khi thu gui DM chao mung. Ly do mo rong: ket ban la cach DUY NHAT de ve sau bot DM bao don hang cho ho duoc, doi den luc bi chan moi gui thi mat nhung nguoi DM duoc nhung chua ket ban. Thu tu "ket ban truoc, DM sau" la CO CHU DICH va co test chan: `GROUP_JOIN_WELCOME_TEMPLATE_DEFAULT` da co cau nhac "Nho bam chap nhan loi moi ket ban cua em" nen loi moi phai den truoc de user doc DM la thay san thong bao. Cau nhac do viet dang loi NHAC chap nhan, **khong khang dinh "em da gui loi moi roi"**: that bai pho bien nhat cua `sendFriendRequest` khong phai loi he thong ma la nguoi do DA LA BAN cua tai khoan bot (ban be that cua chu bot vao group), luc do cau khang dinh se thanh noi sai. Best-effort tuyet doi: loi ket ban chi log, KHONG duoc chan DM chao mung phia sau (co test chan). Danh doi da duoc user chap nhan 2026-10-01: moi ket ban hang loat toi nguoi la la tin hieu spam MANH hon nhan tin va Zalo gioi han so loi moi/ngay, nen rui ro han che tai khoan cao hon truoc - CHUA co throttle giua cac loi moi (join bang link nhom co the vao nhieu nguoi cung luc), them khi nao thay bi chan that.

**Bay van hanh**: cau nhac ket ban nam trong default cua template, nen instance da tung bam Luu o `/admin/settings` se KHONG thay no (DB de default) - phai vao sua tay o `groupJoinWelcomeTemplate`.

## Thả tim tin nhắn trong group

(2026-09-24, yeu cau truc tiep cua user) **Tha tim tin nhan user trong GROUP**: `reactHeart()` goi `api.addReaction(Reactions.HEART, {data:{msgId,cliMsgId}, threadId, type})` NGAY khi nhan ra tin co link san pham - TRUOC khi goi API tao link (co chu dich: user thay bot da nhan duoc tin trong luc cho, do la muc dich ca tinh nang). He qua da duoc user chap nhan: link hoa ra khong tao duoc (vd Shopee Video) thi tin do VAN da duoc tha tim. CHI lam trong group, khong lam trong DM. An toan voi co che chong chen ngang cua FAQ: reaction ve qua listener event `reaction` RIENG, khong phai event `message`, nen tim bot tu tha khong bi `handleSelfMessage` hieu nham la admin go tay roi tu khoa FAQ.

## Gửi tin chủ động vào group + phát hiện group

(2026-09-11) sendGroupMessage(groupId, message): gui tin CHU DONG vao 1 group (khong mention ai, khac sendGroupReply) - dung boi notifyZaloGroup trong index.ts. Kem 2 duong phat hien group cho bang zalo_groups: syncKnownGroups() chay 1 lan moi lan dang nhap (getAllGroups() chi tra ve ID nen phai goi tiep getGroupInfo(ids) de lay ten hien thi cho admin) va maybeRegisterGroup() cho group chua biet vua thay tin nhan (bot duoc add vao group moi GIUA luc dang chay) - chi goi getGroupInfo cho group CHUA BIET, khong phai moi tin nhan. Ca 2 deu best-effort, loi chi log canh bao.

## Roster thành viên group → /admin/users

(2026-10-09, yeu cau truc tiep cua user)

**Roster thanh vien group -> /admin/users**: `syncGroupRoster()` ghi moi thanh vien cua group ADMIN DA TICK vao `zalo_known_users` + ho so (ten/avatar) vao `user_profiles`.

**KHONG TON LENH GOI MANG NAO MOI o duong chinh**: `memberIds` va `currentMems[{id,dName,avatar}]` nam SAN trong response `getGroupInfo` ma `syncKnownGroups` da goi - truoc day bi vut di. Zalo chi tra `currentMems` cho MOT PHAN thanh vien o group lon, uid con lai duoc goi bu bang `getGroupMembersInfo` **theo lo <=50** (goi ca 500 uid 1 lan co the bi tu choi CA LO); buoc bu nay best-effort - loi chi log, user VAN duoc ghi nhan (chi thieu ten). Bo uid cua CHINH bot qua `api.getOwnId()`. Ba duong ghi: `syncKnownGroups` (luc dang nhap), nhanh `GroupEventType.JOIN` (thanh vien moi, khong phai cho restart), va `syncGroupMembers(groupId)` PUBLIC - goi tu `POST /admin/settings/zalo-groups` khi admin vua tick group (best-effort, `.catch()`, **khong duoc lam fail viec luu lua chon cua admin**). Doc co `notify_enabled` SAU khi upsertZaloGroup: group vua xuat hien lan dau mac dinh TAT nen khong bi lay thanh vien - day la chot giu group gia dinh/ban be cua chu bot ra ngoai danh sach khach hang.

## FAQ trong DM + chống chen ngang

(2026-09-13) DM con tra loi cau hoi FAQ qua faqService (xem `.claude/rules/faq-zalo-dm.md`) - nhanh "khong phai xemhh, khong chua link" truoc day IM LANG tuyet doi gio thu nhan dien chu de truoc, khong nhan ra thi VAN im lang (hanh vi chi mo rong chu khong dao nguoc quyet dinh 2026-08-21). **Chong chen ngang khi admin dang chat voi user**: bot chay `selfListen: true` nen nhan duoc CA tin do CHINH tai khoan nay gui ra - tin nao msgId KHONG nam trong SentMessageTracker (sentMessageTracker.ts) thi la ADMIN GO TAY -> khoa FAQ thread do N phut (setting `faq_mute_minutes`, mac dinh 30). Lenh "/im" (khoa vo thoi han) va "/noi" (mo) CHI nhan khi isSelf nen user khong goi duoc. **MOI tin DM bot gui PHAI di qua sendTrackedDirect()** - gui thang api.sendMessage se lam bot tuong tin cua CHINH MINH la admin go tay roi TU KHOA CHINH MINH (sendGroupReply/sendGroupMessage thi khong can, group khong co FAQ). Thread bi khoa CHI tat FAQ - link san pham va "xemhh" VAN LUON chay (tien cua user, khong duoc im).

## session.ts

**session.ts** — luu/doc credentials (cookie/imei/userAgent) vao file JSON de khong phai quet QR lai moi lan restart

## telegram/bot.ts

**telegram/bot.ts** — Telegraf, long polling (khong dung webhook). 1 tin nhan co the chua link nhieu merchant khac nhau — moi merchant duoc reply rieng. Lenh "xemhh" (DM only) tra ve link dashboard. Khuyen mai (getPromotions) mac dinh TAT (PROMOTIONS_DISPLAY_LIMIT=0), xem code van con neu can bat lai.
