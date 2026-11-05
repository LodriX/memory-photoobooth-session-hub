# SessionHub

Bahasa domain untuk mengelompokkan hasil pemotretan LumaBooth dan menyajikannya sebagai galeri yang dapat diakses pengunjung.

## Language

**Event**:
Kumpulan sesi pemotretan untuk satu acara, yang hasilnya tersimpan dalam kelompok tersendiri.

**Sesi**:
Sekelompok foto milik satu pengunjung yang dipasangkan dengan hasil cetaknya; sesi lengkap memiliki Print dan sedikitnya satu Single. Foto yang belum punya pasangan Print tetap dapat menjadi sesi yang belum lengkap.

**Single**:
Satu foto hasil pemotretan yang siap ditampilkan kepada pengunjung, terpisah dari hasil gabungan cetaknya.
_Avoid_: Original

**Print**:
Gambar hasil gabungan foto untuk satu sesi yang dibuat menggunakan layout cetak LumaBooth. Jumlah foto dalam layout dapat berbeda antartemplate, umumnya dua sampai empat.

**Template**:
Sebutan di galeri untuk Print yang sudah jadi, bukan berkas rancangan layout mentah.
_Avoid_: Template mentah

**QR sesi**:
Kode yang membuka halaman galeri milik satu sesi ketika dipindai pengunjung.

**QR print**:
Gambar QR tambahan dari hasil LumaBooth yang dapat menempel pada Print tertentu; berbeda dari QR sesi yang menuju halaman galeri.

**Original**:
Hasil tangkapan kamera sebelum menjadi Single yang ditampilkan kepada pengunjung; dapat tersedia dalam format foto atau RAW.

**Animated**:
Media bergerak yang dihasilkan bersama pemotretan, misalnya video boomerang; bukan bagian dari Single atau Print.

**Leftover**:
Single yang belum memperoleh pasangan Print setelah sesi dikelompokkan.

**Sesi tanpa print**:
Kelompok Leftover yang belum memiliki Print, tetapi tetap memiliki halaman galeri dan QR sesi.
_Avoid_: Sesi lengkap
