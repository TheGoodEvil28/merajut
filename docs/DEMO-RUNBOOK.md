# Demo Marajut dari permintaan sampai serah terima

Siapkan sesi browser pelanggan dan admin yang terpisah serta layar WhatsApp mitra. Gunakan satu permintaan sintetis dan catat kode pesanan yang muncul di website. Di preview privat, pastikan **Operasional → Pengiriman WhatsApp** menunjukkan gateway siap dan mitra tujuan sudah menyetujui pengiriman uji. Untuk latihan tanpa WhatsApp sungguhan, jalankan skenario `RFC-0004 dispatch authorization, queue recovery and signed replies` dalam panduan pengujian. Penawaran dan pembayaran dalam demo menggunakan data sintetis dan `PAYMENT_MODE=demo`. [Panduan pengujian](TEST-RUN-GUIDEBOOK.md#formulir-penawaran-whatsapp--28-november-2026-utc)

| Urutan | Peragakan | Yang terlihat |
| --- | --- | --- |
| 1. Permintaan | Sebagai pelanggan, pilih layanan permak, minta dua pakaian dengan fitting, lalu kirim permintaan. | Permintaan tampil di **Pesanan Saya** dan di antrean **Pesanan** admin dengan kode yang sama. |
| 2. Kesediaan mitra | Kirim pengumuman lewat **Kirim ke grup**. Mitra menyalin kode dari pengumuman dan membalas admin lewat chat pribadi. Untuk meminta penawaran sekaligus, admin dapat membuka **Hubungi mitra** dan mitra mengisi bagian 1–5. Admin meninjau balasan yang terhubung lalu memilih **Penjahit bersedia**. | Setelah kesediaan dicatat, pesan **Pesanan sudah diambil** masuk antrean ke grup awal. Periksa statusnya di **Riwayat WhatsApp**. Mitra yang terpilih melanjutkan lewat chat pribadi. Jika sudah ada penawaran dalam balasan, draft terisi. |
| 3. Periksa penawaran | Buka **Buat penawaran**. Jika penawaran belum dikirim mitra, gunakan **Tindak lanjut WhatsApp mitra → Minta penawaran dari mitra → Konfirmasi kirim** untuk meminta jawaban lengkap. | Setelah balasan masuk, muat ulang halaman. Periksa total harga untuk seluruh pakaian, tanggal selesai, serah terima, fitting, dan catatan. Jika mitra perlu fitting tetapi belum mengusulkan jadwal, admin melihat pengingat untuk melengkapi waktu dan lokasi. |
| 4. Persetujuan pelanggan | Admin meninjau draft dan memilih **Kirim penawaran**. Admin bisa menyalin tautan. Pelanggan membuka permintaan yang sama, meninjau harga dan fitting, lalu memilih **Setujui penawaran**. | Penawaran terbit setelah tindakan admin. Pelanggan melihat pesanan dan jadwal fitting di website. |
| 5. Pengerjaan | Admin mengirim **Konfirmasi mulai pengerjaan** dan, bila perlu, **Koordinasikan fitting**. Mitra menyalin contoh yang sesuai, mengisi tanggal atau progres, dan membalas dengan kode pesanan. Admin mencatat **Mulai pengerjaan** ketika pekerjaan dimulai, lalu dapat meminta progres lewat **Minta kabar pengerjaan**. | Tampilkan blok contoh untuk progres, jahitan siap, dan konfirmasi atau usulan jadwal fitting. Pelanggan melihat jadwal dan status pesanan. Pada pesanan uji yang melewati tenggat, tampilkan **Minta pembaruan lewat tenggat**. |
| 6. Pembayaran | Admin memilih **Tandai jahitan siap** dan dapat mengirim **Kabari pembayaran masih ditunggu**. Pelanggan memulai pembayaran demo. Admin memilih **Verifikasi simulasi lunas** sebelum mengirim **Kabari pembayaran lunas**. | Pelanggan dan admin melihat **Lunas**. Pesan ke mitra menyebut bahwa pembayaran adalah simulasi. |
| 7. Serah terima | Admin mengirim **Koordinasikan serah terima**. Setelah mitra mengonfirmasi pengambilan atau pengiriman lewat WhatsApp, admin mencatat prosesnya lalu memilih **Selesaikan pesanan**. | Pesanan tampil selesai di riwayat pelanggan. Admin dapat menelusuri balasan mitra dan status tiap tahap. |

Salin formulir dan pertahankan referensi asli. Gunakan **Contoh pengisian** di dalam pesan sebagai acuan. Berikut contoh balasan untuk dua pakaian dengan total Rp50.000. Sesuaikan tanggal dan jam WIB sebelum demo. Jika berhalangan, cukup isi **Bersedia menerima pesanan: TIDAK**.

```text
📋 *Referensi:* AB12CD34

*1. KESEDIAAN PENGERJAAN*
Bersedia menerima pesanan: YA

*2. PENAWARAN HARGA*
Harga tetap (Rp): 50.000
Catatan biaya tambahan:

*3. ESTIMASI PENGERJAAN*
Perkiraan selesai (tanggal): 14/01/2027
Estimasi durasi (hari): 4

*4. KEBUTUHAN FITTING*
Perlu fitting: YA
Jadwal fitting (WIB): 12/01/2027 14:00
Lokasi fitting: Studio uji
Catatan fitting: Coba panjang celana.

*5. SERAH TERIMA DAN CATATAN*
Cara serah terima: AMBIL
Catatan tambahan: Ambil di studio setelah lunas.
```

Jika autoisi belum muncul, cek **Riwayat WhatsApp**. Mitra dapat mengirim ulang blok lengkap dengan kode yang sama setelah memperbaiki format. Admin juga dapat mengisi draft secara manual. [Pemeriksaan balasan dan akses](TEST-RUN-GUIDEBOOK.md#formulir-penawaran-whatsapp--28-november-2026-utc)
