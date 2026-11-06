# The head unit's userland: glibc 2.27 and libstdc++ of GCC 7 (Ubuntu 18.04), as idrive7-apps builds the gate: the
# library is loaded into the HMI, so it is built as the HMI's C++ is.
FROM ubuntu:18.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        g++ libc6-dev make binutils \
    && rm -rf /var/lib/apt/lists/*
