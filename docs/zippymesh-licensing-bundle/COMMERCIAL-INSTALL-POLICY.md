# Commercial Install Counting Policy

Version 1.0  
Effective Date: March 13, 2026

This policy explains how **Zippy Technologies LLC** counts commercial installs for the **Zippy Mesh LLM Router** under the repository license for:
- `zippymesh-router`
- `zippymesh-dist`

**Contact:** Support@GoZippy.com  
**Mailing Address:** 1515 E Lewis, Wichita, Kansas 67211, Sedgwick County, Kansas, United States

---

## 1. Base Rule

Commercial use requires payment of **USD $1,000 per Install**. An Install is counted for each separately deployed or separately instantiated commercial runtime of the Product unless Zippy Technologies LLC agrees otherwise in a signed writing.

---

## 2. What Counts as One Install

The following each count as **one Install** when used commercially:
- one physical server running the Product,
- one virtual machine running the Product,
- one container replica or pod replica serving production traffic,
- one dedicated customer instance,
- one edge appliance or on-prem deployment,
- one separately embedded or bundled installed copy delivered to a customer,
- one production node in a clustered deployment.

---

## 3. What Usually Counts as More Than One Install

The following usually count as **multiple Installs**:
- autoscaled replicas, counted per active provisioned production replica,
- active-active or active-passive HA nodes, counted per provisioned node,
- separate staging or pilot environments used for a commercial customer or commercial readiness,
- per-customer dedicated instances,
- regional deployments where the Product is separately deployed in multiple regions.

---

## 4. What Does Not Count by Default

The following do **not** count by default unless they are used to provide a commercial runtime service:
- local developer workstations,
- ephemeral CI or CD jobs lasting under 24 hours and used only for build or test,
- non-production educational demonstrations,
- purely personal non-commercial use.

---

## 5. SaaS and Managed Service Guidance

For SaaS, hosted, API, inference, gateway, and managed service use, each production runtime instance or replica used to serve customers counts as an Install unless otherwise stated in a signed enterprise agreement.

---

## 6. Customer Delivery Guidance

For OEM, embedded, white-label, on-prem, or appliance delivery, each installed customer copy counts as an Install.

---

## 7. Ambiguity Rule

If a deployment topology could reasonably be counted in more than one way, the interpretation used by **Zippy Technologies LLC** controls unless the parties have a signed written agreement stating otherwise.

---

## 8. Reporting

Commercial users must keep accurate records of:
- deployment dates,
- environment type,
- instance counts,
- customer-dedicated instances,
- fees paid.

Questions about counting should be directed to **Support@GoZippy.com** before deployment.
