FROM debian:trixie-slim

COPY motioneye.tar.gz /tmp/

RUN set -e; \
    mkdir /tmp/motioneye; \
    tar -xzf /tmp/motioneye.tar.gz -C /tmp/motioneye --strip-components=1; \
    apt-get -q update; \
    DEBIAN_FRONTEND='noninteractive' apt-get -qq -o 'Dpkg::Options::=--force-confnew' --no-install-recommends install ca-certificates curl python3 fdisk; \
    printf '%s\n' '[global]' 'break-system-packages=true' 'no-cache-dir=true' 'root-user-action=ignore' > /etc/pip.conf; \
    curl -sSfO 'https://bootstrap.pypa.io/get-pip.py'; \
    python3 get-pip.py; \
    python3 -m pip install -U /tmp/motioneye; \
    motioneye_init --skip-systemd --skip-apt-update; \
    python3 -m pip uninstall -y pip; \
    apt-get clean; \
    rm -r /var/lib/apt/lists /var/cache/apt /tmp/motioneye /tmp/motioneye.tar.gz get-pip.py

COPY preview /usr/local/lib/preview

RUN python3 /usr/local/lib/preview/seed.py

EXPOSE 8765 9000

ENTRYPOINT ["sh", "/usr/local/lib/preview/entrypoint.sh"]
