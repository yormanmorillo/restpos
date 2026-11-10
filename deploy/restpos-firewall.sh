#!/bin/bash
set -euo pipefail
IFACE="$(ip route show default | awk '{print $5; exit}')"
if [[ -z "${IFACE}" ]]; then
  echo "No se pudo detectar la interfaz pública." >&2
  exit 1
fi
/usr/sbin/iptables -C DOCKER-USER -i "${IFACE}" -p tcp --dport 3000 -j DROP 2>/dev/null \
  || /usr/sbin/iptables -I DOCKER-USER 1 -i "${IFACE}" -p tcp --dport 3000 -j DROP
/usr/sbin/ip6tables -C DOCKER-USER -i "${IFACE}" -p tcp --dport 3000 -j DROP 2>/dev/null \
  || /usr/sbin/ip6tables -I DOCKER-USER 1 -i "${IFACE}" -p tcp --dport 3000 -j DROP
