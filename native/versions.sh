# Pinned dependency versions and source URLs (native/fetch-sources.sh downloads them into native/src).
ZLIB_V=1.3.1;        ZLIB_URL=https://github.com/madler/zlib/releases/download/v$ZLIB_V/zlib-$ZLIB_V.tar.gz
PNG_V=1.6.43;        PNG_URL=https://download.sourceforge.net/libpng/libpng-$PNG_V.tar.xz
JPEG_V=3.0.3;        JPEG_URL=https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/$JPEG_V/libjpeg-turbo-$JPEG_V.tar.gz
TIFF_V=4.6.0;        TIFF_URL=https://download.osgeo.org/libtiff/tiff-$TIFF_V.tar.gz
EXPAT_V=2.6.2;       EXPAT_URL=https://github.com/libexpat/libexpat/releases/download/R_2_6_2/expat-$EXPAT_V.tar.xz
LCMS_V=2.16;         LCMS_URL=https://github.com/mm2/Little-CMS/releases/download/lcms$LCMS_V/lcms2-$LCMS_V.tar.gz
FFTW_V=3.3.10;       FFTW_URL=https://www.fftw.org/fftw-$FFTW_V.tar.gz
FFI_V=3.4.6;         FFI_URL=https://github.com/libffi/libffi/releases/download/v$FFI_V/libffi-$FFI_V.tar.gz
PCRE2_V=10.44;       PCRE2_URL=https://github.com/PCRE2Project/pcre2/releases/download/pcre2-$PCRE2_V/pcre2-$PCRE2_V.tar.bz2
GLIB_V=2.78.6;       GLIB_URL=https://download.gnome.org/sources/glib/2.78/glib-$GLIB_V.tar.xz
SIGC_V=2.12.1;       SIGC_URL=https://download.gnome.org/sources/libsigc++/2.12/libsigc++-$SIGC_V.tar.xz
GLIBMM_V=2.66.7;     GLIBMM_URL=https://download.gnome.org/sources/glibmm/2.66/glibmm-$GLIBMM_V.tar.xz
LENSFUN_V=0.3.4;     LENSFUN_URL=https://github.com/lensfun/lensfun/archive/refs/tags/v$LENSFUN_V.tar.gz
EXIV2_V=0.28.3;      EXIV2_URL=https://github.com/Exiv2/exiv2/archive/refs/tags/v$EXIV2_V.tar.gz
# phase 2: OpenMP, OpenColorIO, CTL
LLVM_V=22.1.7        # openmp runtime, from a sparse git checkout of llvm-project (src/llvm-openmp)
IMATH_V=3.2.2;       IMATH_URL=https://github.com/AcademySoftwareFoundation/Imath/archive/refs/tags/v$IMATH_V.tar.gz
DEFLATE_V=1.23;      DEFLATE_URL=https://github.com/ebiggers/libdeflate/archive/refs/tags/v$DEFLATE_V.tar.gz
OPENEXR_V=3.2.4;     OPENEXR_URL=https://github.com/AcademySoftwareFoundation/openexr/archive/refs/tags/v$OPENEXR_V.tar.gz
CTL_V=1.5.5;         CTL_URL=https://github.com/ampas/CTL/archive/refs/tags/ctl-$CTL_V.tar.gz
YAMLCPP_V=0.8.0;     YAMLCPP_URL=https://github.com/jbeder/yaml-cpp/archive/refs/tags/$YAMLCPP_V.tar.gz
PYSTRING_V=1.1.4;    PYSTRING_URL=https://github.com/imageworks/pystring/archive/refs/tags/v$PYSTRING_V.tar.gz
MINIZIP_V=4.0.7;     MINIZIP_URL=https://github.com/zlib-ng/minizip-ng/archive/refs/tags/$MINIZIP_V.tar.gz
OCIO_V=2.5.2;         OCIO_URL=https://github.com/AcademySoftwareFoundation/OpenColorIO/archive/refs/tags/v$OCIO_V.tar.gz
# Android only (bionic has no iconv below API 28, no libintl)
ICONV_V=1.17;        ICONV_URL=https://ftp.gnu.org/pub/gnu/libiconv/libiconv-$ICONV_V.tar.gz
# LibRaw: not a tarball but a git checkout (native/fetch-sources.sh puts it in native/src/LibRaw)
LIBRAW_URL=https://github.com/LibRaw/LibRaw.git
LIBRAW_REV=211ec9340888b66f430e23ec9ec5afaad01887ca    # 0.22.0-121-g211ec934
# LibRaw has no CMake build of its own: LibRaw-cmake has the CMakeLists.txt and cmake/ to copy into it
LIBRAW_CMAKE_URL=https://github.com/LibRaw/LibRaw-cmake.git
LIBRAW_CMAKE_REV=eb98e4325aef2ce85d2eb031c2ff18640ca616d3
