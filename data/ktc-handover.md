# KTC Website — Handover Document (Operation Report)

Prepared by Muze Innovation. This is a curated summary of recurring incidents
on the KTC Website project, taken from MA reports, with root cause and
resolution/workaround for each. Treat this as ground truth alongside any
matching Jira case found in the `KTC` project.

## CMS / Content

### Request to Clear Cache
Root Cause: เว็บไซต์มีคอนเทนต์เยอะ ทำให้ CMS ใช้เวลาประมวลผล Clear Cache นานกว่าปกติ ผู้ใช้จึงเห็นข้อมูลบน Frontend ไม่อัปเดตทัน
Resolution: ใช้เมนู Cache Flushing ในระบบ CMS — แนะนำ **Flush Pages** โดยนำ URL/Path ของหน้าที่ต้องการมาวางในช่อง Input แล้วกด Flush Pages (ล้างเฉพาะหน้านั้น ไม่กระทบระบบโดยรวม). ⚠️ ห้ามกด **Flush All** โดยเด็ดขาดเว้นแต่จำเป็นสูงสุดตามคำแนะนำทีม Technical เพราะจะทำให้ล้างแคชทุกหน้าพร้อมกัน เสี่ยง Server Overload / System Down.

### ข้อมูล tab คณะกรรมการไม่แสดง
Root Cause: หน้าเว็บอยู่ในสถานะ Draft เพราะผู้ใช้กด Unpublish ก่อนกด Save Draft ทำให้เนื้อหาเวอร์ชันที่ออนไลน์อยู่ถูกถอดออกไปด้วย
Resolution: เข้าหน้านั้นใน CMS ตรวจสอบเนื้อหาแล้วกด Publish ใหม่. ตรวจสอบประวัติสถานะย้อนหลังได้ที่ปุ่ม **Versions** มุมขวาบนของหน้า CMS (ดูสถานะ Draft / Previously Published / Published ตามเวลา).

### ไม่สามารถ Duplicate Article ได้ ขึ้น Error: Something went wrong
Root Cause: องค์ประกอบ Reusable Block ภายใน Article ขัดข้องทำให้ Duplicate ไม่สมบูรณ์ (ระบบยังตรวจสอบ URL Slug ซ้ำตอน Publish อยู่ดี เช่น "Duplicate slug ... found in articles")
Resolution (Workaround เดิม): ลบ Reusable Block ออกจาก Article ต้นฉบับก่อน แล้วค่อย Duplicate
Resolution (ถาวร): ทีมพัฒนาแก้ไข Reusable Block และ Deploy แล้ว ปัจจุบัน Duplicate Article ที่มี Reusable Block ได้ตามปกติ ไม่มี Error นี้แล้ว

## Promotion

### ไม่พบ Category ใน CMS
Root Cause: มีหมวดหมู่ที่มีคำต่อท้าย "migrate" (ย้ายมาจากระบบเก่า) ปะปนอยู่จำนวนมาก ทำให้หาหมวดหมู่จริงไม่เจอ
Resolution: เปลี่ยนสถานะหมวดหมู่ที่มีคำว่า "migrate" เป็น Unpublish ทั้งหมด. ตรวจสอบสถานะได้ที่เมนู **Promotion Categories** คอลัมน์ Status (Published/Draft)

### Field หมายเลขบัตรประชาชนไม่ส่งข้อมูลไปที่ CRV
Root Cause: ตั้งชื่อฟิลด์ (Name) และ Dev Config ผิด (เช่นตั้งเป็น `idCard`) ไม่ตรงกับ parameter ที่ระบบ CRV ของ KTC กำหนด
Resolution: ต้องตั้งค่าช่อง Name และ Key ใน Dev Config เป็น `citizenId` (ตัวพิมพ์เล็ก-ใหญ่ตามนี้) เสมอ

### Form ส่งค่าไป CRV ไม่ถูกต้อง (เช่น ฟอร์มโปรโมชันประกัน AIA)
Root Cause: ส่วนใหญ่เกิดจากตั้งค่าฟิลด์ใน CMS ไม่สมบูรณ์
Resolution: ก่อนส่งต่อ Dev ให้ตรวจสอบ 2 อย่างก่อน — (1) CMS Field Settings: Name, Dev Config, CRV Field Type, Campaign Code ของแต่ละตัวเลือกถูกต้องหรือไม่ (2) Verify Lead Source: เมนู Promotion Forms Submissions ดูคอลัมน์ Landing Page Url ว่ามาจาก Website หรือ Mobile. ถ้าตั้งค่าถูกหมดแล้ว ค่อย Escalate ให้ Dev เช็ค Log ต่อ

### Promotion Campaign Code = DN6 ไม่ส่งค่า Field ยอดใช้จ่ายบาง Transaction
Root Cause: Version Mismatch ระหว่าง KTC Website และ KTC Mobile — ฟอร์มฝั่ง Website อัปเดตให้ส่งค่า CRV ถูกต้องแล้ว แต่ฟอร์มประเภท Migration ไม่ได้อัปเดตตาม ทำให้ฟอร์ม Migration ส่งค่าผิด (Mobile ฝั่งเดิมยังส่งถูกเพราะยังไม่ได้แก้โค้ด). ปัจจุบันแก้ไขและ Deploy ทั้งสองฝั่งตรงกันแล้ว
Resolution: ตรวจสอบ Lead Source ก่อน escalate — ดูคอลัมน์ URL ในหน้า Lead Submit Promotion Form ถ้าขึ้นต้นด้วย `https://m-promo.ktc.co.th` แปลว่ามาจาก KTC Mobile

### หน้า Promotion Detail ขนาดฟอนต์ Detail กับ Term & Condition ไม่เท่ากัน
Root Cause: Font size ระหว่าง Detail กับ Terms & Conditions แสดงผลไม่เท่ากัน
Resolution: ปรับผ่าน Custom CSS ที่หน้า System ของ Promotion ใน CMS (เช่น `/admin/collections/pages/238`) หาฟิลด์ **Custom Css** แล้วใส่โค้ดคุมขนาดฟอนต์/ระยะห่าง กด Publish จะมีผลกับทุกหน้าโปรโมชันอัตโนมัติ

### ต้องการใช้ Campaign Code เดียวกัน (เช่น PHO) แต่กรอกข้อมูลได้ 2 สิทธิพิเศษพร้อมกัน
Root Cause: 2 สิทธิพิเศษใช้ฟอร์มและ Campaign Code เดียวกัน ทำให้ CRV แยกไม่ออกว่าคะแนนที่กรอกเป็นของสิทธิ์ไหน (ใช้ Campaign Code + ตัวแปรเดียวกันส่ง 2 ค่าพร้อมกันไม่ได้)
Resolution: เปลี่ยนฟิลด์รับค่าใน CRV ให้ต่างกันแม้ Campaign Code เดิม เช่น สิทธิ์ผ่อนชำระ → field `point`, สิทธิ์ชำระเต็มจำนวน → field `opt1`

### หน้าภาษาไทย ปุ่ม Submit ไม่ Active ให้กด
Root Cause: ชื่อตัวแปร (Name) ของฟอร์มหน้าไทย/อังกฤษไม่ตรงกัน และมีตัวอักษรพิเศษ/เว้นวรรคในช่อง Name ของหน้าไทย ทำให้ระบบอ่านค่าตัวแปรไม่ได้
Resolution (มาตรฐานตั้งชื่อฟิลด์): TH/EN ต้องเป็นคำเดียวกันเสมอ, ห้ามใส่ตัวอักษรพิเศษ, ถ้าต้องมีหลายคำห้ามเว้นวรรค ให้ใช้ Underscore แทน (เช่น `No_BIB`)

## Search

### ต้องการซ่อนการ์ดออกจาก Search
Root Cause: อยากซ่อนการ์ดบางรายการจาก Global Search แต่ยังเข้าถึงได้จากหน้าหมวดหมู่/โปรโมชันหลัก ผลลัพธ์ขึ้นกับ Display Mode ที่ตั้งไว้
Resolution:
- Display Mode = `LINK_OUTSIDE` (เช่นการ์ด Store List): ซ่อนจาก Search ได้โดย Unpublish แต่จะหายจากหน้า Category ด้วย (LINK_OUTSIDE ออกแบบมาเพื่อ Store List เท่านั้น)
- ร้านค้าย่อยใน Store List: Unpublish ได้ทันที จะหายจาก Search แต่ยังโชว์ใน Store List ของโปรโมชันหลักตามปกติ
- กติกาทั่วไปสำหรับเนื้อหา Store List: ตั้งสถานะเป็น Unpublish เสมอถ้าไม่อยากให้ปนในผลค้นหา

### Logic การ sort ผล search เรียงจากอะไร
Root Cause: ผู้ใช้สอบถาม Ranking/Sorting logic ของ Global Search
Resolution: ระบบใช้ Algolia แบบ Tie-breaking ตามลำดับ default: `typo, geo, words, filters, proximity, attribute, exact, custom` (สะกดถูกมาก่อน / ใกล้ตำแหน่งมาก่อน / จำนวนคำตรงมากกว่ามาก่อน / ตรง filter มากกว่ามาก่อน / คำใกล้กันมาก่อน / เจอใน field สำคัญมาก่อน / ตรงคำค้นทุกคำมาก่อน / custom business ranking ท้ายสุด). แนะนำให้คงค่า default ของ Algolia ไว้

## Redirect URL

### สอบถาม Url เข้าไม่ได้ (ลิงก์มี query parameter ต่อท้าย เช่น UTM / fbclid)
Root Cause: ตั้ง Redirect URL ใน CMS ไว้แล้ว แต่เมื่อเข้าผ่านลิงก์ที่มีพารามิเตอร์ต่อท้าย (UTM tags, `fbclid` จากแคมเปญ) ระบบไม่ Redirect ให้ เพราะ URL ไม่ตรงกับ Source เป๊ะๆ
Resolution: ต้องเติมเครื่องหมาย wildcard `?*` ต่อท้าย URL ต้นทางในช่อง **Src** ที่หน้า Redirect Url Items เช่น `/promotion/travel/online-travel-agency/traveloka-dining?*` — ครอบคลุมพารามิเตอร์ทุกแบบที่ตามหลัง `?`

## Technical Issue

### Stream timeout บนหน้าเว็บ
Root Cause: หน้าเว็บโหลดไม่ได้ ขึ้น "stream timeout" — จัดเป็น Technical Issue ระดับ Urgent
Resolution: ต้อง Escalate ให้ทีมพัฒนา/ผู้เกี่ยวข้อง Monitor และแก้ไขทันทีเมื่อพบ (System Down/Timeout ระดับนี้ห้ามรอ). เคสที่ผ่านมาทีมพัฒนาแก้และ Deploy เรียบร้อยแล้ว ทดสอบแล้วไม่พบ error ซ้ำ

### ไฟล์หน้า Merchant ขึ้น Error (ดาวน์โหลดไม่ได้)
Root Cause: ลิงก์เอกสารพิมพ์ชื่อไฟล์ผิด (Typo) เช่นต่อท้ายด้วย `.pdfest.pdf` ทำให้หาไฟล์ใน CMS ไม่เจอ เกิด Error `NoSuchKey`
Resolution: ตรวจสอบว่ามีไฟล์ชื่อถูกต้องอยู่ในโฟลเดอร์ CMS หรือไม่ ถ้าไม่มีให้อัปโหลดใหม่ แล้ว Copy Link ของไฟล์ที่ถูกต้องมาแทนที่ลิงก์เดิม. วิธีตรวจสอบ: นำ URL ไฟล์ที่มีปัญหาไปเทียบชื่อ-นามสกุลกับที่อยู่ในเมนู Document (เลือกโฟลเดอร์ให้ตรง path เช่น `merchant`)

### Field ไม่ดึงเบอร์โทรศัพท์มาแสดงอัตโนมัติเมื่อ Login
Root Cause: ชื่อตัวแปร (Name) ของฟิลด์เบอร์โทรศัพท์ใน CMS ไม่ตรงกับตัวแปรมาตรฐานที่ระบบรองรับ (เช่นตั้งเป็น `mobile`) ทำให้ Data Mapping จากระบบสมาชิกดึงไม่ได้
Resolution: ต้องตั้งชื่อฟิลด์ (Name) เป็นหนึ่งในคำที่ระบบรองรับเท่านั้น: `tel`, `mobileNo`, `phoneNumber`, `mobilePhone`

### Download file รายงานการประชุม (AGM) ปีเก่าใช้งานไม่ได้
Root Cause: Path ของไฟล์ใน CMS ถูกต้อง แต่ไฟล์ต้นฉบับบน PROD/CDN ขาดหายไปจริง (คาดว่า Migration ไฟล์มาไม่ครบ) — ยืนยันได้จากฝั่ง DEV ยังดาวน์โหลดไฟล์เดียวกันได้ปกติ
Resolution:
1. ตรวจสอบ Path ใน CMS อีกครั้งว่าไม่ได้พิมพ์ผิด (Typo)
2. ถ้า Path ถูกแต่ไฟล์หายจริง ต้อง Escalate ให้ทีมเซิร์ฟเวอร์/DevOps ตรวจสอบ Storage บน PROD และดึงไฟล์ Backup กลับมาวางที่ Path เดิม
3. เมื่อไฟล์กลับมาที่ CDN แล้ว ลิงก์จะใช้งานได้ทันทีโดยไม่ต้องแก้อะไรใน CMS เพิ่ม
