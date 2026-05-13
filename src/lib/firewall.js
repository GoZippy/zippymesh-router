import { exec } from "child_process";
import os from "os";

function run(cmd) {
  // simple wrapper; callers should sanitize arguments
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout || stderr);
    });
  });
}

function sanitizeIp(ip) {
  // allow digits, dot, colon, slash (for CIDR)
  if (/^[0-9A-Fa-f:\.\/]+$/.test(ip)) return ip;
  throw new Error("Invalid IP address");
}

export async function applyDefaultFirewallRules(allowedIps = ["127.0.0.1"]) {
  const platform = os.platform();
  try {
    if (platform === "linux") {
      // try ufw first
      await run(`ufw --force reset`);
      await run(`ufw default deny incoming`);
      await run(`ufw default allow outgoing`);
      for (const ip of allowedIps) {
        await run(`ufw allow from ${ip}`);
      }
      await run("ufw enable");
    } else if (platform === "win32") {
      // using netsh for windows defender firewall
      for (const ip of allowedIps) {
        await run(`netsh advfirewall firewall add rule name=\"ZMLR Allow ${ip}\" dir=in action=allow remoteip=${ip}`);
      }
      // block others on port 20128
      await run(`netsh advfirewall firewall add rule name=\"ZMLR Block All\" dir=in action=block protocol=TCP localport=20128`);
    } else if (platform === "darwin") {
      // use pfctl (macOS)
      // note: requires sudo
      let rules = `block in all\n`;
      for (const ip of allowedIps) {
        rules += `pass in from ${ip} to any\n`;
      }
      await run(`echo "${rules}" | sudo pfctl -f -`);
      await run("sudo pfctl -e");
    }
  } catch (e) {
    console.error("Failed to apply firewall rules:", e);
  }
}

export async function blacklistIp(ip) {
  try {
    ip = sanitizeIp(ip);
  } catch (e) {
    console.error("Invalid IP for firewall blacklist", e);
    return;
  }

  // add to firewall if possible
  const platform = os.platform();
  try {
    if (platform === "linux") {
      await run(`ufw deny from ${ip}`);
    } else if (platform === "win32") {
      await run(`netsh advfirewall firewall add rule name=\"ZMLR Blacklist ${ip}\" dir=in action=block remoteip=${ip}`);
    } else if (platform === "darwin") {
      await run(`echo "block in from ${ip} to any" | sudo pfctl -f -`);
    }
  } catch (e) {
    console.error("Firewall blacklist failed:", e);
  }
}
