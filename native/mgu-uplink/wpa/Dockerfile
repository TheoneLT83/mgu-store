# wpa_supplicant for the head unit (build.sh): Ubuntu 18.04 has the unit's glibc (2.27) and
# libnl-3, libnl-genl-3 and libcrypto 1.1 of the versions the unit has (check.sh). The source
# is upstream's 2.10 release, checked by sha256.
FROM ubuntu:18.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        gcc libc6-dev make binutils patch ca-certificates curl libnl-3-dev libnl-genl-3-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir /src && curl -fsSL -o /src/wpa_supplicant-2.10.tar.gz https://w1.fi/releases/wpa_supplicant-2.10.tar.gz \
    && echo "20df7ae5154b3830355f8ab4269123a87affdea59fe74fe9292a91d0d7e17b2f  /src/wpa_supplicant-2.10.tar.gz" \
    | sha256sum -c -
