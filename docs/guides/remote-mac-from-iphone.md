# Mengendalikan Mac dari iPhone, dari mana saja

TCuFlow berbagi mouse, keyboard, clipboard, dan file **di satu jaringan lokal**. Ia tidak mengirim gambar layar dan tidak bekerja dari luar rumah. Untuk "Mac ditinggal di rumah, dikendalikan dari iPhone", yang dibutuhkan adalah remote desktop. Semua bahan di bawah ini sudah ada di macOS atau gratis.

Waktu: sekitar 30 menit. Hasil: dari iPhone di mana pun (4G/Wi-Fi lain) kamu melihat dan mengendalikan layar Mac, tanpa membuka port di router.

## 1. Nyalakan Screen Sharing di Mac

1. System Settings → General → **Sharing**.
2. Nyalakan **Screen Sharing**.
3. Klik ⓘ di sebelahnya → **Allow access for: Only these users** → pastikan akunmu ada di daftar.
4. Masih di Sharing, nyalakan juga **Remote Login** kalau kamu ingin SSH (opsional).

Catatan: jangan nyalakan "Remote Management" kecuali kamu memang memakai Apple Remote Desktop; Screen Sharing saja cukup.

## 2. Pasang Tailscale di Mac dan iPhone

Tailscale membuat jaringan pribadi terenkripsi (WireGuard) antara perangkatmu, menembus NAT tanpa buka port.

1. Mac: unduh dari https://tailscale.com/download (atau App Store), masuk dengan akun Google/Apple/GitHub.
2. iPhone: pasang **Tailscale** dari App Store, masuk dengan akun yang **sama**, lalu nyalakan VPN-nya saat diminta.
3. Di app Tailscale Mac, catat nama mesinnya, misalnya `macbook-pro` (atau alamat `100.x.y.z`).

Gratis untuk pemakaian pribadi sampai 100 perangkat.

## 3. Pasang viewer di iPhone

Pilih salah satu:

| App | Harga | Catatan |
|---|---|---|
| **Screens 5** | berbayar (langganan) | Paling halus di iPhone/iPad, mendukung VNC Mac langsung |
| **Jump Desktop** | sekali bayar | Stabil, protokol Fluid sendiri kalau pasang Jump Desktop Connect di Mac |
| **RustDesk** | gratis, open source | Perlu pasang RustDesk di Mac juga; bisa pakai server mereka atau server sendiri |

Untuk Screens/Jump lewat VNC:
1. Tambah komputer baru → alamat: nama Tailscale Mac (`macbook-pro`) atau `100.x.y.z`, port 5900, protokol **VNC / Screen Sharing**.
2. Masuk dengan nama pengguna dan kata sandi akun Mac.

## 4. Supaya Mac tetap bisa dihubungi saat tutupnya ditutup

MacBook yang ditutup akan tidur dan Wi-Fi-nya mati. Dua syarat:

1. **Colok charger.** Semua pengaturan di bawah hanya berlaku saat ada daya.
2. System Settings → **Battery** → **Options…**:
   - **Prevent automatic sleeping on power adapter when the display is off** → On.
   - **Wake for network access** → Always (atau "Only on Power Adapter").

Kalau layar MacBook ditutup tanpa monitor eksternal, macOS tetap tidur meskipun pengaturan di atas. Dua jalan keluar:
- **Clamshell mode:** colok monitor eksternal (atau *HDMI dummy plug* seharga puluhan ribu rupiah). Mac menganggap ada layar dan tetap bangun.
- **Biarkan tutupnya sedikit terbuka** dan redupkan layar sampai mati. Paling sederhana.

Uji: tutup/redupkan Mac, tunggu 2 menit, buka Screens di iPhone lewat data seluler. Kalau tersambung, selesai.

## 5. Keamanan singkat

- Screen Sharing hanya terjangkau lewat jaringan Tailscale-mu; dari internet umum port 5900 tidak terbuka.
- Pakai kata sandi akun Mac yang kuat; itu satu-satunya kunci.
- Di Tailscale, nyalakan **Key expiry** default dan hapus perangkat yang hilang dari admin console.
- Kalau sudah tidak dipakai, matikan Screen Sharing lagi.

## Masalah umum

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| iPhone tidak bisa menemukan Mac | VPN Tailscale di iPhone mati, atau Mac tidur | Nyalakan Tailscale di iPhone; cek Mac masih "online" di app Tailscale |
| Tersambung tapi layar hitam | Mac dalam keadaan terkunci dengan layar mati | Normal; ketik kata sandi di viewer, layar akan hidup |
| Lemot | Resolusi Retina penuh | Di Screens/Jump turunkan kualitas atau skala tampilan |
| Putus setelah beberapa menit | Mac tertidur | Ulangi langkah 4; pastikan charger terpasang |
