#!/bin/sh
# Isolated single-node Slurm validation, not a production site configuration.
set -eu
mkdir -p /run/munge /var/log/munge /var/lib/munge /var/spool/slurmctld /var/spool/slurmd
chown munge:munge /run/munge /var/log/munge /var/lib/munge
[ -f /etc/munge/munge.key ] || dd if=/dev/urandom of=/etc/munge/munge.key bs=1024 count=1 2>/dev/null
chown munge:munge /etc/munge/munge.key
chmod 400 /etc/munge/munge.key
cat > /etc/slurm/slurm.conf <<CONFIG
ClusterName=pero-validation
SlurmctldHost=localhost(127.0.0.1)
SlurmUser=root
AuthType=auth/munge
StateSaveLocation=/var/spool/slurmctld
SlurmdSpoolDir=/var/spool/slurmd
ProctrackType=proctrack/linuxproc
TaskPlugin=task/none
JobAcctGatherType=jobacct_gather/none
SelectType=select/cons_tres
SelectTypeParameters=CR_CPU
ReturnToService=2
SlurmdParameters=config_overrides
NodeName=$(hostname) NodeAddr=127.0.0.1 CPUs=8 Boards=1 SocketsPerBoard=1 CoresPerSocket=8 ThreadsPerCore=1 RealMemory=512 State=UNKNOWN
PartitionName=validation Nodes=ALL Default=YES MaxTime=00:05:00 State=UP
CONFIG
printf 'CgroupPlugin=cgroup/v1\n' > /etc/slurm/cgroup.conf
runuser -u munge -- munged --foreground --origin=127.0.0.1 &
attempt=0
until [ -S /run/munge/munge.socket.2 ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 50 ] || { echo 'Munge socket did not become ready' >&2; exit 1; }
  sleep 0.1
done
slurmctld -D &
exec slurmd -D
