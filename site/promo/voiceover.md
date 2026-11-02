# Voice-over — video promosi TCuFlow (46 detik)

**Model: Eleven v3** (bukan Multilingual v2 — hanya v3 yang membaca tag emosi seperti `[excited]`). Suara Indonesia atau multilingual yang terdengar muda dan ceria; **Stability: Creative** (atau ~30) supaya tag berpengaruh, similarity ~75. Hasilkan **satu file** dari blok "Teks siap tempel". Simpan sebagai `site/promo/voice.mp3`, lalu jalankan `scripts/render-promo.sh`: musik latar (`site/promo/bgm.mp3`, dibuat `scripts/make-bgm.py`) otomatis mengecil di bawah suara. Kalau durasinya meleset lebih dari 1–2 detik dari 46 detik, geser nilai `<break>` atau kecepatannya.

Cara tag bekerja di v3: tag dalam kurung siku di awal kalimat mengatur nada kalimat itu; tanda seru dan HURUF KAPITAL menambah tekanan; elipsis `…` memberi jeda dramatis. Jangan tempel tag di tengah kata.

| Detik | Adegan | Nada | Naskah (ID) |
|---|---|---|---|
| 0–5 | Judul | hook, semangat | [excited] Satu keyboard. Dua komputer. SATU meja! Ini TCuFlow. |
| 5–14 | Kursor menyeberang | takjub | [curious] Dorong kursor melewati tepi layar yang menyala… [excited] dan ia muncul di komputer sebelahnya! Mac ke Windows, atau sebaliknya. |
| 14–22 | Keyboard | ringan, yakin | [cheerful] Keyboard ikut pindah. Apa pun yang kamu ketik, masuk ke komputer tempat kursor berada. Pintasan? Tetap jalan! |
| 22–30 | Clipboard & file | lancar, senang | [cheerful] Clipboard dan file ikut! Salin di sini, tempel di sana. Seret file lewat tepi… [excited] dan ia mendarat di komputer satunya! |
| 30–38 | Keamanan | tenang, mantap | [confident] Aman sejak detik pertama. Kode enam digit yang sama di kedua layar, enkripsi TLS satu-tiga, dan tidak ada yang keluar dari jaringanmu. |
| 38–46 | Unduh | klimaks | [excited] Gratis dan open source, untuk macOS dan Windows! [warm] Unduh gratis sekarang. |

## Teks siap tempel (ID)

[excited] Satu keyboard. Dua komputer. SATU meja! Ini TCuFlow. <break time="1.0s" />
[curious] Dorong kursor melewati tepi layar yang menyala… [excited] dan ia muncul di komputer sebelahnya! Mac ke Windows, atau sebaliknya. <break time="1.2s" />
[cheerful] Keyboard ikut pindah. Apa pun yang kamu ketik, masuk ke komputer tempat kursor berada. Pintasan? Tetap jalan! <break time="1.0s" />
[cheerful] Clipboard dan file ikut! Salin di sini, tempel di sana. Seret file lewat tepi… [excited] dan ia mendarat di komputer satunya! <break time="1.0s" />
[confident] Aman sejak detik pertama. Kode enam digit yang sama di kedua layar, enkripsi TLS satu-tiga, dan tidak ada yang keluar dari jaringanmu. <break time="1.0s" />
[excited] Gratis dan open source, untuk macOS dan Windows! [warm] Unduh gratis sekarang.

Kalau hasilnya terlalu heboh, ganti `[excited]` dengan `[enthusiastic]` atau `[upbeat]`; kalau masih datar, turunkan Stability dan tambah tanda seru. Tag yang dikenal v3 dan cocok untuk iklan: `[excited]`, `[enthusiastic]`, `[cheerful]`, `[upbeat]`, `[curious]`, `[confident]`, `[warm]`, `[whispers]`, `[laughs]`.

## English version (same timing)

[excited] One keyboard. Two computers. ONE desk! This is TCuFlow. <break time="1.0s" />
[curious] Push the cursor through the glowing edge of your screen… [excited] and it lands on the computer next to it! Mac to Windows, or the other way round. <break time="1.2s" />
[cheerful] The keyboard follows. Whatever you type goes to the computer the cursor is on. Shortcuts? Still work! <break time="1.0s" />
[cheerful] The clipboard and your files come along! Copy here, paste there. Drag a file through the edge… [excited] and it lands on the other computer! <break time="1.0s" />
[confident] Secure from the first second. The same six-digit code on both screens, TLS one-point-three encryption, and nothing ever leaves your network. <break time="1.0s" />
[excited] Free and open source, for macOS and Windows! [warm] Download it free today.
