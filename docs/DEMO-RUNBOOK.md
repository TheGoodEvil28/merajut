# Demo Marajut dari permintaan sampai serah terima

Siapkan sesi browser pelanggan dan admin yang terpisah serta layar WhatsApp mitra. Gunakan satu permintaan sintetis dan catat kode pesanan yang muncul di website. Di preview privat, pastikan **Operasional → Pengiriman WhatsApp** menunjukkan gateway siap dan mitra tujuan sudah menyetujui pengiriman uji. Untuk latihan tanpa WhatsApp sungguhan, jalankan skenario `RFC-0004 dispatch authorization, queue recovery and signed replies` dalam panduan pengujian. Penawaran dan pembayaran dalam demo menggunakan data sintetis dan `PAYMENT_MODE=demo`. [Panduan pengujian](TEST-RUN-GUIDEBOOK.md#formulir-penawaran-whatsapp--28-november-2026-utc)

| Urutan | Peragakan | Yang terlihat |
| --- | --- | --- |
| 1. Permintaan | Sebagai pelanggan, pilih layanan permak, minta dua pakaian dengan fitting, lalu kirim permintaan. | Permintaan tampil di **Pesanan Saya** dan di antrean **Pesanan** admin dengan kode yang sama. |
| 2. Kesediaan mitra | Admin memilih **Hubungi mitra** dan mengonfirmasi pengiriman. Mitra membalas kode dan menyatakan bersedia. Admin meninjau balasan lalu mencatat **Penjahit bersedia**. | Admin bisa lanjut ke **Susun penawaran**. |
| 3. Formulir WhatsApp | Admin membuka **Tindak lanjut WhatsApp mitra → Minta penawaran dari mitra → Konfirmasi kirim**. Mitra menyalin blok dari `KODE` sampai `CATATAN`, mengganti contoh dengan isian, lalu membalas di chat pribadi yang sama. | Setelah balasan masuk, muat ulang halaman pesanan admin. **Buat penawaran** terisi dengan rincian harga, tanggal selesai, masa berlaku, metode serah terima, fitting, dan catatan. |
| 4. Persetujuan pelanggan | Admin meninjau draft dan memilih **Kirim penawaran**. Admin bisa menyalin tautan. Pelanggan membuka permintaan yang sama, meninjau harga dan fitting, lalu memilih **Setujui penawaran**. | Penawaran terbit setelah tindakan admin. Pelanggan melihat pesanan dan jadwal fitting di website. |
| 5. Pengerjaan | Admin mengirim **Konfirmasi mulai pengerjaan** dan, bila perlu, **Koordinasikan fitting**. Setelah mitra membalas di WhatsApp, admin mencatat mulai pengerjaan dan fitting selesai di website. Minta progres lewat **Minta kabar pengerjaan**. | Pelanggan melihat jadwal dan status pesanan. Pada pesanan uji terpisah yang telah melewati tenggat, tampilkan **Minta pembaruan lewat tenggat**. |
| 6. Pembayaran | Admin memilih **Tandai jahitan siap** dan dapat mengirim **Kabari pembayaran masih ditunggu**. Pelanggan memulai pembayaran demo. Admin memilih **Verifikasi simulasi lunas** sebelum mengirim **Kabari pembayaran lunas**. | Pelanggan dan admin melihat **Lunas**. Pesan ke mitra menyebut bahwa pembayaran adalah simulasi. |
| 7. Serah terima | Admin mengirim **Koordinasikan serah terima**. Setelah mitra mengonfirmasi pengambilan atau pengiriman lewat WhatsApp, admin mencatat prosesnya lalu memilih **Selesaikan pesanan**. | Pesanan tampil selesai di riwayat pelanggan. Admin dapat menelusuri balasan mitra dan status tiap tahap. |

Untuk langkah 3, ganti `AB12CD34` dengan kode yang dikirim dan pilih tanggal mendatang dalam WIB. Contoh ini menghasilkan Rp50.000 untuk dua pakaian. Pakai `FITTING: TIDAK` dan `LOKASI_FITTING: -` bila fitting tidak diperlukan. Jika WhatsApp menyalin seluruh pesan, teks petunjuk di atas `KODE` boleh ikut terkirim.

```text
KODE: AB12CD34
ITEM: Permak celana | 2 | 25000
SELESAI: 2027-01-14
BERLAKU: 48
SERAH_TERIMA: AMBIL
FITTING: 2027-01-12 14:00
LOKASI_FITTING: Studio uji
CATATAN: Coba panjang celana saat fitting, lalu ambil di studio setelah lunas.
```

Jika autoisi belum muncul, cek **Riwayat WhatsApp**. Mitra dapat mengirim ulang blok lengkap dengan kode yang sama setelah memperbaiki format. Admin juga dapat mengisi draft secara manual. [Pemeriksaan balasan dan akses](TEST-RUN-GUIDEBOOK.md#formulir-penawaran-whatsapp--28-november-2026-utc)
