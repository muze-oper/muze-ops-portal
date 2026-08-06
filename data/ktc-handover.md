# KTC Website — Handover Document (Operation Report)

Prepared by Muze Innovation. This is a curated summary of recurring incidents
on the KTC Website project, taken from MA reports and analysis of the full
Jira ticket history (project `KTC`), with root cause and resolution/workaround
for each. Where a Jira key is cited (e.g. KTC-133) it's a real ticket in the
project. Where a case has no final resolution yet, that's stated explicitly
rather than invented — don't present those as solved when answering a
customer.

## CMS / Content

### Request to Clear Cache
Root Cause: เว็บไซต์มีคอนเทนต์เยอะ ทำให้ CMS ใช้เวลาประมวลผล Clear Cache นานกว่าปกติ ผู้ใช้จึงเห็นข้อมูลบน Frontend ไม่อัปเดตทัน
Resolution: ใช้เมนู Cache Flushing ในระบบ CMS — แนะนำ **Flush Pages** โดยนำ URL/Path ของหน้าที่ต้องการมาวางในช่อง Input แล้วกด Flush Pages (ล้างเฉพาะหน้านั้น ไม่กระทบระบบโดยรวม). ⚠️ ห้ามกด **Flush All** โดยเด็ดขาดเว้นแต่จำเป็นสูงสุดตามคำแนะนำทีม Technical เพราะจะทำให้ล้างแคชทุกหน้าพร้อมกัน เสี่ยง Server Overload / System Down.

### แก้ไขเนื้อหาใน CMS แล้ว Publish ไปแล้วแต่หน้าเว็บไม่อัพเดทตาม
Root Cause: สาเหตุหลักคือหน้าเว็บมีการใช้ cache (CDN/edge cache) และเมื่อกด publish จาก CMS แล้ว ระบบไม่ได้ invalidate/flush cache ของหน้านั้นโดยอัตโนมัติ ทำให้หน้าเว็บยังคงแสดงเนื้อหาเวอร์ชันเก่า (KTC-133) นอกจากนี้ยังเคยพบ error จาก API ที่ใช้ update หน้าเพจโดยตรงซึ่งทำให้การ publish ไม่สมบูรณ์ (KTC-35) เป็นปัญหาที่เกิดขึ้นซ้ำบ่อยมากตลอดโปรเจกต์ (พบใน promotion, about page, storelist, banner, corporate information และอีกหลายหน้า เช่น KTC-68, 69, 99, 104, 129, 130, 132, 136)
Resolution: ทีมแก้ปัญหาเฉพาะหน้าด้วยการ manual flush/clear cache ของ URL ที่ user แจ้งมาทุกครั้งที่พบ (KTC-35 เป็นกรณีที่แก้โค้ด API ต้นเหตุแล้ว deploy จบเคสได้) แต่โดยรวมยังไม่มีการแก้ไขที่ root cause แบบถาวรในระดับระบบ — ต้อง flush cache ด้วยมือเป็นรายเคสต่อไป

### Replace ไฟล์ด้วยชื่อไฟล์เดิม (รูปภาพ/เอกสาร) แล้วหน้าเว็บไม่เปลี่ยนตาม
Root Cause: พบ 2 รูปแบบ (1) ระบบ cache-flush/log เบื้องหลังของ CMS อ่านค่า URL slug ที่เป็นภาษาไทยไม่ได้ ทำให้สั่ง flush cache ของหน้าที่มี slug ภาษาไทยไม่สำเร็จ ทั้งที่ path/ไฟล์ใน CMS อัพเดทถูกต้องแล้ว (KTC-97) (2) ตรวจสอบแล้วพบว่าจริงๆ ผู้ใช้ยัง replace ไฟล์บน GCS bucket ไม่สำเร็จจริง (มีการวางไฟล์ใหม่แค่ครั้งเดียวและยังเป็นไฟล์เดิม) ไม่ใช่ปัญหา cache ของระบบ (KTC-140)
Resolution: KTC-97 ทีม flush cache หน้าที่เกี่ยวข้องให้ด้วยมือ ระยะยาวแนะนำเปลี่ยน slug ภาษาไทยเป็นภาษาอังกฤษเพื่อให้ cache-flush ทำงานได้ปกติ KTC-140 ให้ผู้ดูแลไฟล์วางไฟล์ใหม่อีกครั้งให้ถูกต้อง re-check แล้วพบว่าอัพเดทเรียบร้อย

### กด Publish หรือ Save หน้า Article/Promotion แล้วขึ้น Error ไม่สามารถบันทึกได้
Root Cause: พบ 2 แบบภายใต้อาการเดียวกัน (1) ข้อมูลที่ migrate เข้ามาก่อนระบบมี validation ว่า slug ต้องเป็นตัวพิมพ์เล็กทั้งหมด ทำให้ save ไม่ผ่าน ขึ้น error "Slug must be all lowercase" (KTC-57) (2) เนื้อหาใน content text field ยาวเกินค่า default ที่ CMS (Payload) กำหนดไว้ (เดิม 40,000 ตัวอักษร พบกรณีสูงถึง 44,411 ตัวอักษร) (KTC-174, KTC-195)
Resolution: กรณี slug แนะนำแก้ชื่อ slug เป็นตัวพิมพ์เล็กทั้งหมดแล้ว save ใหม่ได้ทันที (KTC-57) กรณี text length ทีมปรับค่า defaultMax-Text-Length จาก 40,000 เป็น 100,000 ตัวอักษร (KTC-174, deploy แล้ว) แต่ยังพบเนื้อหาเกินอีกครั้งภายหลัง จึงขอเพิ่มเป็น 300,000 ตัวอักษร (KTC-195 — ณ ตอนบันทึกยัง Escalated รอ deploy รอบถัดไป ยังไม่ปิดเคส)

### Publish หน้าเป็นภาษาไทยแล้ว แต่หน้าเว็บยังแสดงเนื้อหาภาษาอังกฤษ (หรือกลับกัน)
Root Cause: พบ 3 รูปแบบ (1) มีผู้แก้ไข content ภาษาอังกฤษเข้าไปทับในหน้าภาษาไทยโดยไม่ตั้งใจ (human error) (KTC-116) (2) เนื้อหาบางส่วน (เช่น store list) ของหน้า locale EN ยังไม่ถูกแปล/แก้ไขจริงในระบบ ยังเป็นข้อมูลที่ copy มาจากหน้า TH (KTC-160) (3) logic การเช็คสถานะ publish แยกตามภาษา เดิมรองรับเฉพาะ static page เท่านั้น ไม่ครอบคลุมหน้า dynamic เช่น promotion/article/news/gallery (KTC-177)
Resolution: KTC-116 แก้ไขโดย Restore เวอร์ชันเก่าจาก CMS version history KTC-160 ต้องให้ผู้ดูแลเนื้อหาแก้ไข content ฝั่ง EN ให้ถูกต้องเอง KTC-177 ทีมแก้โค้ดให้ครอบคลุมหน้า dynamic ด้วย deploy และทดสอบผ่านบน PROD ปิดเคสแล้ว

### ตั้งค่าใน CMS เป็น Normal Text แต่หน้าเว็บแสดงผลเป็น Heading Tag (H2/H3)
Root Cause: มี 2 กรณี — กรณีตั้งเป็น H2 บนหน้า credit-card เป็น requirement เดิมเพื่อ SEO ที่ตกลงกันไว้แล้ว (ไม่ใช่บั๊ก) ส่วนกรณีหน้า Help Center เป็นบั๊กจริง โค้ดยังบังคับให้หัวข้อคำถามแสดงเป็น `<h3>` ทั้งที่ CMS ตั้งเป็น Normal Text (KTC-197)
Resolution: กรณีแรกอธิบายให้ user ทราบว่าเป็นการตั้งค่าตาม requirement เดิม กรณี KTC-197 ยังไม่มีการแก้ไขจบ — ทีมระบุว่าต้องแก้โค้ดให้ตรงตาม CMS จริง รอรอบ deploy ถัดไป (สถานะ Escalated/In Progress ณ ตอนบันทึก)

### ไม่สามารถ Duplicate Article ได้ ขึ้น Error: Something went wrong
Root Cause: องค์ประกอบ Reusable Block ภายใน Article ขัดข้องทำให้ Duplicate ไม่สมบูรณ์ (ระบบยังตรวจสอบ URL Slug ซ้ำตอน Publish อยู่ดี เช่น "Duplicate slug ... found in articles")
Resolution (Workaround เดิม): ลบ Reusable Block ออกจาก Article ต้นฉบับก่อน แล้วค่อย Duplicate
Resolution (ถาวร): ทีมพัฒนาแก้ไข Reusable Block และ Deploy แล้ว ปัจจุบัน Duplicate Article ที่มี Reusable Block ได้ตามปกติ ไม่มี Error นี้แล้ว

### ใส่ Custom CSS ใน Reusable Block แล้วไม่ทำงาน
Root Cause: ตัว wrapper ด้านนอกของ reusable block (ระดับ page/section ที่ครอบ block นั้นอยู่) มี custom CSS ของตัวเองอยู่ก่อนแล้ว ซึ่งมี priority สูงกว่าและ override CSS ที่ใส่ไว้ด้านในตัว reusable block เอง
Resolution: นำโค้ด Custom CSS ที่อยู่ด้านนอกไปรวมไว้กับโค้ดด้านในให้อยู่จุดเดียวกัน จึงจะมีผลบังคับใช้ถูกต้อง

### `<br>` (ขึ้นบรรทัดใหม่) ไม่ทำงานในหน้าเว็บ
Root Cause: Reusable block บางประเภท (เช่น component "Rch Form") ไม่รองรับการแสดงผล HTML/rich text เลย จึงไม่แปลง `<br>` เป็นการขึ้นบรรทัดใหม่ ต่างจาก component อีกแบบ (เช่น "Ktc Credit Card Register Form") ที่รองรับ HTML ตามปกติ
Resolution: แนะนำให้เปลี่ยนไปใช้ reusable block ที่รองรับ HTML แทน (เช่น slug `form-creditcard-apply-to-allarticle`) ซึ่ง apply กับทุกบทความที่เรียกใช้ block เดียวกันพร้อมกัน โดยยังไม่ได้ปรับให้ block เดิมรองรับ HTML เพิ่ม

### Field ในฟอร์มแสดงผลบนหน้าเว็บสลับตำแหน่งจากที่คาดไว้
Root Cause: ระบบทำงานถูกต้องอยู่แล้ว หน้าเว็บแสดงผล field ตามลำดับที่ส่งไปยัง CRV แบบ fix ไว้เฉพาะเสมอ (amount, point, fullname, merchant, terms, message, date, opt1-4) ไม่ใช่บั๊ก เพียงแต่ลำดับที่ user ตั้งไว้ในตอนแรกไม่ตรงกับที่คาดหวังจะเห็น
Resolution: ไม่มีการแก้โค้ด หากต้องการสลับตำแหน่งที่แสดงผล ให้ user ปรับลำดับ field ใน CMS ได้โดยตรง

### Field เลขบัตรประชาชนที่ Environment ทดสอบ (SIT) ไม่ Auto-fill/Mask ค่าให้
Root Cause: ฟอร์มตั้งชื่อ field รับค่าเลขบัตรประชาชนเป็น `citizenId` ซึ่งไม่ตรงกับชื่อ field ที่ระบบฝั่งหลังบ้านคาดหวัง (ต้องเป็น `idCard`) ทำให้กลไก auto-fill/mask ไม่ทำงาน
Resolution: เปลี่ยนชื่อ field จาก `citizenId` เป็น `idCard` ให้ตรงกับที่ระบบต้องการ กลไก auto-fill กลับมาทำงานปกติ

### Article ไม่แสดงในหมวดหมู่ที่กำหนด
Root Cause: มี Article อื่นในระบบที่ใส่ค่า category ผิดรูปแบบ ซึ่งไปกระทบทำให้ article อื่นในหมวดหมู่เดียวกันไม่แสดงผลไปด้วย
Resolution: ผูก category ในรูปแบบ "หมวดหลัก > หมวดย่อย" (เช่น "ความรู้ > รู้ก่อนสมัคร") ตามมาตรฐานเดียวกับหมวดอื่น จึงทำให้ article กลับมาแสดงในหมวดหมู่ได้ตามปกติ

### หน้าหมวดหมู่บทความ (Category Listing) ไม่ดึง Banner มาแสดง
Root Cause: เป็นปัญหาจาก Custom CSS ของหน้าหมวดหมู่ที่ยังไม่รองรับการแสดงผล banner ในหน้านั้น
Resolution: ทีมแก้ไข Custom CSS ให้รองรับการแสดง banner แล้ว รอ deploy รอบถัดไปจึงจะขึ้น production และ re-test ผ่านเรียบร้อย

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

### Store List ในหน้า Promotion ไม่แสดง หรือแสดงไม่ตรงกับที่ตั้งค่าไว้ใน CMS
Root Cause: เคสกลุ่มนี้เกิดจากหลายสาเหตุที่ต่างกันในแต่ละครั้ง เช่น แคชของหน้า store list ค้าง (KTC-108), โค้ดที่ควบคุมข้อความ "รายละเอียดเพิ่มเติม" ไม่รองรับการซ่อนกรณี view mode = view only (KTC-142), และโปรโมชั่นหลักที่ผูก Store List ไว้ยังผูก ID เก่าหรือ ID ที่ยัง publish ไม่ถึงวัน (KTC-157) เป็นรูปแบบที่เกิดขึ้นซ้ำบ่อยมากในหลายเคส (เช่น KTC-102, 106, 109, 110, 121, 160) สะท้อนว่าเป็นจุดเปราะบางของระบบทั้งเรื่องแคชและ logic การผูก ID โปรโมชั่นใน CMS
Resolution: แต่ละเคสแก้ไขต่างวิธีกันตามสาเหตุ — เคลียร์แคชให้ user (KTC-108), แก้โค้ดซ่อนข้อความสำหรับ view only mode (KTC-142 — ทดสอบผ่านแล้ว), ชี้แจงกับผู้ใช้ว่าโปรที่ยังไม่แสดงเพราะยังไม่ถึงวัน publish หรือยังผูก ID เก่าไว้ (KTC-157 — ยังไม่เห็นการแก้โค้ดถาวรสำหรับปัญหาการผูก ID ผิด เป็นเพียงการชี้แจงสาเหตุ)

### Promotion หมดเขตแล้วแต่ระบบตัดตอนเป็นเที่ยงคืน (00:00:00) แทนที่จะเป็น 23:59:59 ของวันสุดท้าย
Root Cause: Promotion ที่สร้างใหม่ผ่าน CMS จะ default end date เป็น 23:59:59 เสมอ แต่ Promotion ที่ Migrate มาจากระบบเดิม (Magento) ไม่มีข้อมูลเวลาติดมาด้วย ทำให้เมื่อเข้าสู่ Payload ระบบ default เวลาเป็น 00:00:00 แทน ส่งผลให้โปรโมชั่นดูเหมือนหมดอายุก่อนเวลาจริง
Resolution: ทีมตรวจสอบพบ Promotion ที่ migrate มามีปัญหานี้ทั้งหมด 2,706 รายการ (ในจำนวนนี้ยังไม่หมดอายุและกระทบจริง 863 รายการ) ให้ฝ่ายธุรกิจ confirm รายชื่อแล้วรัน script/แก้ไข manual ปรับเวลาจาก 00:00:00 เป็น 23:59:59 ให้ครบทุกรายการเรียบร้อยแล้ว

### "โปรโมชั่นที่คุณอาจสนใจ" ไม่ดึงตาม Category ที่ถูกต้อง หรือ URL พาไปหน้า 404
Root Cause: มี 2 สาเหตุแยกกัน (1) ควรดึงตามลำดับ Manual Related Promotions → Category เดียวกัน → Parent category เดียวกัน → Random แต่หลังปรับโค้ด SSR เพื่อเพิ่ม performance กลับขาด logic การดึงจาก Category/Parent ไป เหลือแค่ Manual กับ Random (KTC-143) (2) เมื่อโปรโมชั่นถูกผูกไว้มากกว่า 1 Category โค้ดดึง URL จาก Category รอง (ตัวที่สอง) แทนที่จะดึงจาก Category หลัก ทำให้กดแล้วเจอ 404 (KTC-144)
Resolution: แก้โค้ดฝั่ง SSR ให้ query ตามลำดับ priority ที่ถูกต้องครบทุกขั้นตอน (KTC-143) และแก้ logic ให้ดึง URL จาก Category หลักเสมอ (KTC-144) ทั้งสอง deploy และทดสอบผ่านแล้ว (23 มิ.ย. 2026) — ส่วน KTC-153 เป็นอีกกรณีที่ระบบทำงานถูกต้องอยู่แล้ว เพียงแต่การแก้ค่าใน CMS ต้องรอคิว update จึงยังไม่แสดงผลทันที ไม่ใช่บั๊ก

### ลูกค้าลงทะเบียนรับสิทธิ์โปรโมชั่นไม่สำเร็จ หรือกดลิงก์จากสื่อแล้วเจอ 404
Root Cause: พบ 2 รูปแบบ (1) ระบบเว็บไซต์เชื่อมต่อไปยัง CRV ไม่สำเร็จ (Connection Timeout / ETIMEDOUT) ข้อมูลถูกบันทึกใน CMS แล้วแต่ส่งต่อ CRV ไม่ได้ (KTC-114, KTC-156) (2) ลิงก์ที่แจกจ่ายให้ลูกค้า (เอกสาร IRTASK หรือสื่อโฆษณา เช่น EDM) เป็นคนละ URL/slug กับที่ตั้งค่าไว้จริงใน CMS ทำให้กดแล้วเจอ 404 (KTC-182)
Resolution: กรณี Timeout เป็นปัญหาฝั่งระบบหลังบ้าน CRV เอง ทีมตรวจสอบ log ยืนยันแล้วแจ้งผลกลับ ไม่มีการแก้ไขโค้ดฝั่งเว็บไซต์ กรณี URL ผิด ทีมตรวจสอบ URL ที่ถูกต้องใน CMS แล้วแจ้งกลับให้ใช้แทน ยืนยันว่าไม่พบ transaction จากลิงก์ผิดเข้าระบบเลย (เป็นการแจ้งข้อเท็จจริง ไม่ใช่การแก้ไขระบบ)

### ลูกค้า/ทีม Operation ขอข้อมูล Log ที่ระบบส่งไปที่ CRV เพิ่มเติมเพื่อตรวจสอบ Campaign Code
Root Cause: เป็นคำร้องขอที่เกิดขึ้นซ้ำบ่อยมากตลอดโปรเจกต์ (เกือบทุกเดือน เช่น KTC-42, 51, 58, 63, 67, 72, 73, 81, 103, 111) ส่วนใหญ่เพื่อตรวจสอบว่าค่าที่ระบบส่งไปให้ CRV ตรงกับที่ CMS ตั้งค่าไว้หรือไม่ โดยเฉพาะฟอร์มประเภท radio choice ที่กังวลว่าอาจส่งค่าเป็น Label ของ option แทนที่จะเป็น Campaign Code ตรงๆ — สะท้อนว่าฝั่ง Operation ไม่มีช่องทางตรวจสอบ log การส่งข้อมูลไป CRV ได้เอง ต้องพึ่งทีมเว็บไซต์ดึงให้ทุกครั้ง
Resolution: ทีมตรวจสอบ Log ย้อนหลังแล้วดึงค่าที่ระบบส่งจริงมาเทียบให้ทีละเคส ส่วนใหญ่พบว่าค่าที่ส่งตรงตามที่ตั้งค่าไว้ (บางเคสพบว่าเป็น Label ไม่ใช่ Code จริงๆ จึงต้องปรับค่าใน CMS field เพิ่ม) ไม่มีการแก้ไขระบบถาวรเพื่อให้ฝ่าย Operation เข้าถึง log เองได้โดยไม่ต้องพึ่งทีมเว็บไซต์

### Unpublish/ลบ Promotion แล้วหน้ายังไม่ขึ้น 404 ทันที หรือลิงก์ใน Store List ขึ้น 404
Root Cause: 2 สาเหตุแยกกัน (1) หลัง Unpublish ต้องรอ Clear Cache ประมาณ 30 นาทีก่อนหน้าเว็บจะเปลี่ยนเป็น 404 (KTC-25) (2) การ Optimize เกี่ยวกับ URL category ที่ deploy ไปก่อนหน้า ทำให้เรียก category ไม่ครบถ้วน เป็นผลข้างเคียง (regression) จากการ deploy นั้น ทำให้ลิงก์ Store List กดแล้วเจอ 404 (KTC-32)
Resolution: KTC-25 ทีมเดฟอยู่ระหว่าง tuning ประสิทธิภาพเพื่อลดเวลารอ cache (ยังไม่มีผลสำเร็จสุดท้ายยืนยัน) KTC-32 ทีม Hot fix ขึ้น Production ทันทีและเปิด IR (IR-2603-00270) บันทึกการแก้ไขอย่างเป็นทางการ

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

### Search Suggestion ที่หน้าโฮมไม่แสดง หรือแสดง Layout ผิดปกติ
Root Cause: พบ 2 อาการแยกกัน (1) Search Suggestion หายไปทั้งหมดหลังจากผู้ใช้ Clear Search History (2) Suggestion แสดงผลแต่ Layout ผิดปกติ เกิดจาก Custom CSS ของ component ที่ควบคุมการแสดงผลมีปัญหา
Resolution: ทีมแก้ไข Custom CSS ให้แสดงผลปกติ และแก้โค้ดหลังบ้านเพิ่มเติมสำหรับกรณี suggestion หายหลัง clear history มีการ deploy และ re-check ยืนยันใช้งานได้ปกติทั้งสองกรณี

### Promotion ที่หมดอายุ หรือยังไม่ Publish แต่ยังค้นเจอในผลการค้นหา
Root Cause: กรณีแรกเกิดจากการแก้ไขวันที่เริ่ม/สิ้นสุดโปรโมชั่นผ่านหน้า EN แล้วกด publish ทำให้ระบบส่งข้อมูลวันที่ไปอัปเดตที่ Algolia เฉพาะภาษา EN เท่านั้น หน้า TH จึงยังพบข้อมูลวันที่เก่าอยู่ กรณีที่สองคือ Promotion ที่ตั้งค่า Display Mode เป็น `LINK_OUTSIDE` ถูกออกแบบให้ค้นเจอได้ตาม requirement เดิม แต่ผู้ใช้ต้องการให้บางรายการแสดงเฉพาะใน Store List โดยไม่ต้องการให้ค้นหาเจอ ซึ่งเดิมระบบยังไม่รองรับการแยกสิทธิ์นี้
Resolution: กรณีวันที่ไม่ตรง ทีมแก้ไขให้ส่งข้อมูล start/end date ไปที่ Algolia ครบทั้งสองภาษา ตรวจสอบสุ่มแล้วไม่พบปัญหาซ้ำ กรณี LINK_OUTSIDE ทีมเพิ่ม field ใหม่สำหรับตั้งค่า flag ควบคุมว่าจะให้ค้นหาเจอหรือไม่ deploy และทดสอบผ่านแล้ว

### ค้นหาด้วยชื่อ/คำที่เกี่ยวข้องกับโปรโมชั่นหรือหน้าเพจแล้วไม่พบผลลัพธ์เลย
Root Cause: กรณีแรกเกิดจาก Plugin ที่ใช้ตัดคำ (word segmentation) ก่อนส่งข้อมูลไปยัง Algolia มีปัญหาหลังอัปเดต ทำให้ CMS ส่งข้อมูลไป Algolia ไม่ถูกต้อง กรณีที่สองคือหน้านักเขียน (author page) — ชื่อผู้เขียนไม่เคยถูกส่งเข้า Algolia index มาก่อนเลย จึงค้นหาด้วยชื่อนักเขียนแล้วไม่เจอหน้านั้น (ไม่ใช่บั๊ก แต่เป็นช่องว่างของฟีเจอร์ที่ยังไม่รองรับ)
Resolution: กรณี Plugin ทีม hotfix โดยแก้ function ใน CMS และเอา plugin ตัดคำที่มีปัญหาออกทั้งหมด กรณีหน้านักเขียน ทีมแก้โค้ดให้ส่งชื่อผู้เขียนเข้า Algolia index เพิ่มเติม deploy และทดสอบบน PROD ผ่านแล้ว

## Redirect URL

### สอบถาม Url เข้าไม่ได้ (ลิงก์มี query parameter ต่อท้าย เช่น UTM / fbclid)
Root Cause: ตั้ง Redirect URL ใน CMS ไว้แล้ว แต่เมื่อเข้าผ่านลิงก์ที่มีพารามิเตอร์ต่อท้าย (UTM tags, `fbclid` จากแคมเปญ) ระบบไม่ Redirect ให้ เพราะ URL ไม่ตรงกับ Source เป๊ะๆ
Resolution: ต้องเติมเครื่องหมาย wildcard `?*` ต่อท้าย URL ต้นทางในช่อง **Src** ที่หน้า Redirect Url Items เช่น `/promotion/travel/online-travel-agency/traveloka-dining?*` — ครอบคลุมพารามิเตอร์ทุกแบบที่ตามหลัง `?`

### URL สามารถเข้าถึงหน้าเว็บได้ทั้งที่ Slug ไม่ถูกต้อง
Root Cause: เป็นปัญหาที่เคยพบมาก่อนช่วง Go Live แล้ว (เช่น `/article/travel-story` ที่ผิด ก็ยังเข้าถึงหน้าได้ปกติแทนที่จะเป็น `/article/travel-stories` ที่ถูก) เป็นความคลาดเคลื่อนของ Routing ที่ยอมรับ Slug ไม่ตรง format ด้วย
Resolution: ทีมและ KTC ตกลงกันไว้ตั้งแต่ก่อน Go Live ว่าจะแก้ไขภายหลังตาม Priority ซึ่งเคสนี้จัดเป็น Priority ต่ำ (Low) ติดตามผ่านการ์ดแยก (WS-2349) — ยังไม่ได้รับการแก้ไขจริงในทันที

### หน้า Promotion Category ขึ้น Error "too many redirects"
Root Cause: มีการตั้งค่า Redirect Rule สำหรับ path หนึ่ง (เช่น `/promotion/education`) ที่ชี้กลับมาที่ตัวเอง (self-referencing) ทำให้เกิด Redirect วนลูปไม่จบ
Resolution: ทีมลบ Redirect Rule ที่ผิดออกทั้ง TH และ EN version (เช่น `/promotion/education` และ `/en/promotion/education`) ทำให้หน้ากลับมาใช้งานได้ตามปกติ พร้อมแจ้งให้ user ทราบสาเหตุ

### ตั้งค่า Redirect ไว้ใน CMS แล้วไม่ทำงานตามที่ Set
Root Cause: พบ 3 กรณี (1) ติด Browser/Server Cache ที่ยังไม่อัพเดทตาม (2) Slug ที่ผู้ใช้แจ้งว่าตั้ง redirect ไว้ ตรวจสอบแล้วไม่พบอยู่จริงใน CMS (3) หน้าดังกล่าวมีการตั้ง Redirect ไว้ที่ระบบอื่นนอกเหนือจาก CMS ด้วย (สังเกตจาก header/font ที่ไม่ตรงกับเว็บ) ทำให้ Redirect ที่ตั้งใน CMS ไม่มีผลเพราะ Request ไม่เคยส่งมาถึงระบบของทีมเลย
Resolution: กรณีแรกรอ Cache หมดอายุจะกลับมาใช้งานได้ปกติ กรณีที่สองไม่มีการแก้ไขระบบ ผู้ใช้เลือกเปลี่ยน URL ใหม่โดยตรงแทนและลบการตั้งค่าเดิมออก กรณีที่สามต้องตรวจสอบกับทีมที่ดูแล Redirect ระบบอื่นที่ตั้งไว้ทับซ้อนกันอยู่ (ไม่มีความคืบหน้าการยืนยันสาเหตุที่แท้จริงปรากฏในเคสตัวอย่างที่ตรวจสอบ)

### พบ URL บนเว็บลงท้ายด้วย Query Parameter ?v=ตัวเลข จำนวนมาก
Root Cause: มี Bot ชื่อ "iframely" เข้ามาเว็บพร้อมแนบ query parameter `?v=` ติดมาด้วยเป็นจำนวนมาก (กว่า 3,000 รายการ) และโค้ดเดิมมีพฤติกรรมจดจำ (cache) query parameter ที่ติดเข้ามาไปบันทึกไว้ใน Canonical Tag ด้วย ลักษณะเดียวกับปัญหา UTM parameter ที่เคยเจอ
Resolution: ทีม Devops ตรวจสอบยืนยัน root cause จากพฤติกรรมของ Bot ดังกล่าว — ในเคสตัวอย่างที่ตรวจสอบยังไม่ปรากฏการยืนยันแก้ไขโค้ดหรือผลทดสอบหลัง deploy จึงถือว่ายังไม่มีข้อมูลยืนยันการปิดจบปัญหาชัดเจน

### Canonical URL ของบางหน้าไม่ใช่ URL ของหน้าตัวเอง แต่ชี้ไป URL อื่น
Root Cause: เมื่อ Admin publish หน้าเว็บ และมี User กดเข้ามาผ่านลิงก์ที่มี UTM parameter ติดอยู่ ระบบจะ cache query parameter ของ UTM นั้นติดไปกับ Canonical URL ด้วย ทำให้ Canonical ไม่ใช่ URL ของหน้าตัวเองอย่างที่ควรจะเป็น
Resolution: ระยะสั้นให้ทีม Clear Cache หน้าที่ได้รับผลกระทบเพิ่มเติมเป็นรายเคส ระยะยาวทีมแก้ไขโค้ดให้ตรวจสอบค่าจาก Canonical URL Field ก่อนและตัด Query Parameter ที่ติดมาโดยไม่ตั้งใจออก มีการ deploy และทดสอบบน PROD ผลออกมา Pass

## SEO

### Favicon ของเว็บไม่แสดงใน Google Search หรือต้องการเปลี่ยน Favicon
Root Cause: Google ไม่แสดง Favicon เพราะไม่มีการกำหนด URL ของไฟล์ favicon ไว้ใน Site Meta ของ CMS เลย (KTC-11) ส่วนอีกสองเคสเป็นคำขอเปลี่ยนไอคอนตามรอบ Campaign/ความต้องการทางธุรกิจ (ขอเปลี่ยนเป็นสีดำ แล้วภายหลังขอเปลี่ยนกลับเป็นสีแดงตามปกติ — KTC-148, KTC-168) ซึ่งพบว่าค่า href ของ `<link rel="icon">` ชี้ไปยังไฟล์ favicon ที่ไม่ตรงกับที่ต้องการแสดงผลจริง
Resolution: KTC-11 เพิ่ม URL ของ favicon ลงใน Site Meta ใน CMS โดยตรง ต้องรอ Google re-crawl ประมาณ 2 สัปดาห์ก่อนจะแสดงผลถูกต้อง KTC-148 ต้องแก้ที่ Coding และ Deploy โดยทีม Dev (ทดสอบผ่านหลัง Deploy 18 มิ.ย.) ส่วน KTC-168 แก้ได้ทันทีที่ Site Meta โดยเปลี่ยนค่า href จาก `/favicon-black-white.png` เป็น `/favicon.ico`

### Auto-generated XML Sitemap ทำงานไม่ถูกต้อง
Root Cause: พบ 2 ปัญหาแยกกัน คือ (1) การ Manual Add Sitemap ผ่านเมนู CMS โดยใส่ path ที่ขึ้นต้นด้วย "/" ซ้ำกับที่ระบบ generate อัตโนมัติ ทำให้เกิด URL ซ้ำซ้อนกัน (เช่นหน้า Home กลายเป็น `www.ktc.co.th//`) (KTC-138) และ (2) มี URL ที่ Status 404/Noindex หลุดเข้าไปใน Sitemap ในขณะที่ URL ที่ Status 200/Indexable บางส่วนกลับไม่ถูกดึงเข้า Sitemap (KTC-155)
Resolution: KTC-138 แก้ไขให้ระบบรองรับการจัดการ "/" ที่ซ้ำกันได้ (deploy 4 มิ.ย. ทดสอบผ่านบน Prod) KTC-155 ทีมนัดประชุมหา solution และแก้ไขไฟล์ข้อมูลให้ตรงตามเกณฑ์ (Status 200, Self-canonical, Indexable) เสร็จสมบูรณ์เมื่อ 13 กรกฎาคม 2026 จึงปิดเคส

### Schema Markup ประเภท breadcrumbList ของหน้า Article แสดงลำดับไม่ถูกต้อง
Root Cause: URL Structure ของบางหน้าเรียงผิดลำดับ (เป็น /article/sub-cat/cat/slug แทนที่จะเป็น /article/cat/sub-cat/slug ที่ถูกต้อง) ทำให้ breadcrumbList ที่ generate ตาม URL ผิดตามไปด้วย พบตัวอย่างจริงที่หน้า travel-stories/america/usa และบางหน้าใน help ที่ breadcrumb ไม่ตรงกับหน้าจริง
Resolution: ทีมทดสอบ breadcrumb ครบทุกประเภทหน้า (static, category, detail, tags, author ฯลฯ) และแก้ไขโค้ดให้ breadcrumbList แสดงลำดับ item และชื่อถูกต้องตรงกับ title ของหน้า แล้ว deploy เรียบร้อย

### Alt/Title Tag ของรูปภาพไม่แสดงผลตามที่ตั้งค่าไว้
Root Cause: ระบบไม่ได้ query ค่า ALT ที่เป็นแบบ Local (แยกตามภาษา) มาใช้ ทำให้ค่า ALT ที่แสดงผลจริงไม่ตรงกับที่ผู้ใช้ตั้งค่าไว้
Resolution: ระยะสั้นแนะนำให้ผู้ใช้ใส่ค่าใน field Alt ตัว default (ไม่ใช่ local) ไปก่อน (ใช้ได้กับหน้าที่มีภาษาเดียว แสดงผลได้ทันทีใน title image tag) ระยะยาวทีมแก้ไขโค้ดให้ query ค่า ALT/Caption มาใช้แทน default — deploy 13 กรกฎาคม 2026 และยืนยันผลหลัง deploy เรียบร้อยแล้ว

### Environment UAT ต้องการ Disallow Google ไม่ให้ Index / หน้า Search ที่ UAT แสดง Code ผิดปกติ
Root Cause: กรณี Disallow (KTC-76 — เช่น uat.pvb4.com, sit.pvb4.com) เป็นการปรับตั้งค่า SEO/robots ระดับ Environment ไม่ใช่บั๊ก กรณีหน้า Search แสดง Code ผิดปกติ (KTC-77) เกิดจาก Component "Recommend Block" ที่ UAT ไม่ได้อัพเดทโค้ดตามเมื่อมีการอัพเดท Code Center ส่วนฝั่ง Production ยังไม่ใช้ Recommend Block จึงไม่พบปัญหานี้
Resolution: KTC-76 ปรับ SEO Setting ที่ UAT ให้ Disallow Google แล้วรอ Google เคลียร์ Index เก่า KTC-77 แก้ไข Recommend Block ให้ตรงกับ Code Center ปัจจุบัน deploy 23 เม.ย. 2026 และ re-test บน UAT ผล Success ปิดเคส

## UI / Display Issues

### ข้อความหรือ Banner ล้นขอบจอบนมือถือ (Responsive ผิดปกติ)
Root Cause: พบสาเหตุต่างกันในแต่ละหน้า แต่ล้วนเป็นปัญหาการแสดงผลบนมือถือ ได้แก่ ผู้ใช้กรอกข้อความใน field description ยาวเกินไปทำให้ซ้อนทับกับรูป Banner (KTC-101), ข้อความใต้บล็อกหนึ่งยาวเกินขอบ container ทำให้ข้อความด้านบนกระเด็นออกนอกกรอบไปด้วย (KTC-124), และบล็อก Banner ในหน้า merchant มีขนาดผิดปกติทำให้หน้าจอ mobile เลื่อนซ้าย-ขวาได้แทนที่จะพอดีจอ (KTC-149)
Resolution: ทั้งสามเคสแก้ไขด้วยการใส่ Custom CSS เฉพาะจุดสำหรับ mobile เป็นมาตรการเร่งด่วนก่อน จากนั้นแก้โค้ดถาวรให้ตรงตาม Figma UI แล้ว deploy ขึ้นจริง ทดสอบผ่านทุกเคส

### Filter รายได้ในหน้า Credit Card ไม่ทำงาน หรือปุ่ม Filter Chip ไม่รีเซ็ทค่า
Root Cause: การปรับปรุง Performance (ปรับ Global Variable และวิธี Query) มีผลข้างเคียงกระทบ Component ที่พึ่งพา Pattern เดิม — Filter รายได้หน้า Credit Card อ่านค่าตัวแปรแบบ `{{xxx}}` ไม่ได้ (KTC-79) และปุ่ม Chip ไม่ถูกอัพเดทกลับไปที่สถานะ active อันแรกเมื่อกด tab เปลี่ยนเมนู (KTC-122)
Resolution: KTC-79 แก้ไขระยะสั้นโดยปรับค่า field รายได้ใน CMS จาก `{{xxx}}` ให้เป็น text ปกติ วางแผนแก้ไข global variable ระยะยาว KTC-122 แก้โค้ดให้กด tab แล้วต้องอัพเดท chip กลับไป active อันแรกในทุกหน้าที่ใช้ chip แบบนี้ (ยกเว้นหน้า Credit Card) ทั้งสอง deploy และทดสอบผ่านแล้ว

### ภาพ Banner ไม่ขึ้น หรือมีภาพซ้อนกระพริบระหว่างโหลดหน้า
Root Cause: พบ 3 กรณี (1) ขณะโหลดหน้า ระบบให้ความสำคัญกับขนาดจอ Mobile ก่อนเป็นค่าเริ่มต้น ซึ่ง Section Form บน Mobile มีพื้นหลังต่างจาก Desktop ทำให้เห็นพื้นหลังนั้นแวบหนึ่งก่อนระบบตรวจจับว่าเป็น Desktop จริง (KTC-180) (2) การ deploy ปรับ Performance กระทบการแสดงผล background ของฟอร์มโดยตรง (KTC-105) (3) ภาพ Banner ไม่ขึ้นในหน้า Landing Page — ทีมยังหาสาเหตุที่แท้จริงไม่พบ (KTC-193)
Resolution: KTC-180 แก้โค้ดให้รอผลตรวจจับประเภทอุปกรณ์ (Device Detection) ก่อนค่อยแสดงผล Section นั้น deploy แล้วปิดเคส KTC-105 ปรับ CSS ใส่ background ตรงๆ เป็นการชั่วคราวก่อน ตามด้วยแก้โค้ดถาวร deploy และทดสอบผ่านบน PROD KTC-193 ยังไม่มีการแก้ไขถาวร มีเพียง Workaround คือนำภาพ Banner ออกจาก CMS แล้วใส่กลับเข้าไปใหม่ก่อนกด Publish Changes (เคสนี้ยังอยู่ในสถานะ Escalated/รอสาเหตุแท้จริง ยังไม่ปิดจบ)

## Forms

### แบบฟอร์ม Contact Us ส่งข้อความไม่ได้ หรือขาด Field ที่จำเป็น
Root Cause: พบ 3 รูปแบบ (1) ส่งฟอร์มขึ้น error 504/500 เนื่องจากระบบเชื่อมต่อไปยัง SMTP Server ของ KTC เพื่อส่งอีเมลแจ้งเตือนไม่ได้ จนเกิด Connection Timeout — เป็นปัญหาที่เกิดซ้ำมากกว่าหนึ่งครั้ง (KTC-92) (2) ผู้ใช้ต้องการสร้างฟอร์มติดต่อแบบ Custom Field ที่เก็บข้อมูลลง Lead ได้ แต่ระบบยังขาด field รองรับ (KTC-126) (3) ฟอร์มสมัครบัตรเครดิตไม่แสดงหน้า "เลือกเวลาติดต่อกลับ" เพราะ Dev Config ตั้งลำดับ Step ผิด — Field "information_required" (ที่ถูกลบออกจาก Block ไปแล้วแต่ลืมลบออกจาก Dev Config) ถูกตั้งให้มาก่อน Field "contact_back_time" ทำให้ระบบข้าม Step ไปเลย (พบว่าฝั่ง Mobile ไม่เจอปัญหาเพราะตั้งค่า Step ถูกอยู่แล้ว) (KTC-161)
Resolution: KTC-92 ทีมตรวจสอบ Log ยืนยัน Timeout ที่เกิดจากการเชื่อมต่อ SMTP ของ KTC และส่งข้อมูล Log ให้ทีม KTC ไปตรวจสอบร่วมกับผู้ดูแลระบบอีเมล (ไม่มีการแก้ไขโค้ดฝั่งเว็บในเคสนี้) KTC-126 เพิ่ม Field ที่ต้องการ (เช่น field "noted") เข้าไปใน Contact Form Submissions ทดสอบผ่านบน UAT แล้วนำขึ้น Production KTC-161 ปรับลำดับ Step ให้ "contact_back_time" มาก่อน หรือลบ Field "information_required" ที่ไม่มีอยู่จริงออกจาก Dev Config ยืนยันฟอร์มแสดงผลถูกต้องแล้ว

### OA Lead (LINE Official Account) ไม่ Generate ไฟล์ไปวางที่ระบบของ KTC หรือข้อมูลบาง Field ไม่ถูกส่ง
Root Cause: พบ 2 รูปแบบ (1) ตรวจสอบ Log ฝั่งเว็บไซต์แล้วพบว่ามีการ Generate ไฟล์ตามปกติ ปัญหาจริงอยู่ที่ Script ฝั่ง KTC ที่ใช้ดึงไฟล์ไปวางมีปัญหา ไม่ใช่ความผิดพลาดจากฝั่งเว็บไซต์ (KTC-83) (2) Field "product_code" และ "product_name" ใน CMS ไม่ได้ถูกกำหนดให้เป็น Required Field ทำให้หากผู้สร้างฟอร์มไม่กรอกค่าเหล่านี้ (พบว่า Program Code บางตัวเช่น AMR ไม่ได้เซ็ทค่า PRODUCT_NAME ไว้) ระบบจะไม่ส่งค่า Field ที่เกี่ยวข้อง (เช่น รหัสผู้แนะนำ) ไปด้วย แม้ Column ปลายทางจะถูกเตรียมไว้รองรับแล้วก็ตาม (KTC-145)
Resolution: KTC-83 แจ้งให้ทีม KTC Rerun Script ฝั่งของตนเองเพื่อดึงไฟล์ไปวางใหม่ ปัญหาคลี่คลายจากฝั่ง KTC เอง KTC-145 ทีมระบุสาเหตุชัดเจน (field ไม่ถูกบังคับกรอกใน CMS) และแนะนำให้กรอกค่า product_code/product_name ให้ครบถ้วน แต่ยังไม่มีการยืนยันว่ามีการแก้ไขตั้งเป็น Required Field อย่างเป็นทางการ — ถือว่ายังไม่มีข้อสรุปการแก้ไขที่ชัดเจนในเคสนี้

## Technical Issue

### Stream timeout บนหน้าเว็บ
Root Cause: หน้าเว็บโหลดไม่ได้ ขึ้น "stream timeout" — จัดเป็น Technical Issue ระดับ Urgent
Resolution: ต้อง Escalate ให้ทีมพัฒนา/ผู้เกี่ยวข้อง Monitor และแก้ไขทันทีเมื่อพบ (System Down/Timeout ระดับนี้ห้ามรอ). เคสที่ผ่านมาทีมพัฒนาแก้และ Deploy เรียบร้อยแล้ว ทดสอบแล้วไม่พบ error ซ้ำ

### CMS (หลังบ้าน) หรือหน้าเว็บขึ้น Error "upstream request timeout" / 504 Gateway
Root Cause: พบ 3 รูปแบบ — (1) ผู้ใช้กด Save Redirect URL จำนวนมากในเวลาไล่เลี่ยกัน ทำให้ CPU ของระบบพุ่งสูง (CPU Peak) จนเกิด Timeout (KTC-70) (2) หน้า Contact Us ขึ้น error 504/500 ตอนกดส่งฟอร์ม — เคสแรกที่แจ้งเข้ามา (KTC-71) ทีมหาสาเหตุที่แน่ชัดไม่ได้เพราะผู้แจ้งระบุเวลาที่แน่นอนไม่ได้ ตรวจ log ไม่พบร่องรอยตรงกัน จึงปิดเคสไปก่อนโดยไม่มีข้อสรุป จนกระทั่งเกิดซ้ำอีกครั้ง (KTC-92) จึงพบว่าสาเหตุจริงคือ Connection Timeout ระหว่างเว็บไซต์กับ SMTP Server ของ KTC ตอนพยายามส่งอีเมลแจ้งเตือน (3) เข้า CMS ไม่ได้ (KTC-107) ตรวจสอบแล้วพบว่าไม่เกี่ยวกับระบบฝั่ง Muze แต่เป็นปัญหาฝั่ง IT ของ KTC เอง
Resolution: KTC-70 ทำปุ่ม "Sync" สำหรับหน้า Redirect URL ใน CMS แยกการ Create/Update/Delete ไม่ให้ทำงานหนักพร้อมกัน deploy 23 เม.ย. 2026 ทดสอบผ่าน KTC-71/92 ยืนยันสาเหตุเป็น SMTP Timeout ของ KTC เอง ส่งข้อมูล Log ให้ทีม KTC ไปตรวจสอบร่วมกับผู้ดูแลระบบอีเมลต่อ (ไม่มีการแก้ไขโค้ดฝั่งเว็บ) KTC-107 แจ้งให้ฝั่ง KTC เปิด IR กับทีม IT ของตัวเอง ไม่ใช่ความรับผิดชอบของทีมเว็บไซต์

### เปิด Promotion จาก Mobile App แล้ว Error เนื่องจากตั้งค่า Cache (Imperva) ไม่ตรงกับ Website
Root Cause: การตั้งค่า Cache ของ Mobile App ใช้ระบบ Imperva ซึ่งตั้งค่าไม่เหมือนกับฝั่ง Website ทำให้เมื่อกดโปรโมชั่นจาก App แล้ว Redirect มาที่ Website เกิด Error ขึ้น (KTC-137) ยังสรุปไม่ได้ 100% ว่า Imperva เป็นสาเหตุจริงหรือไม่
Resolution: ยังไม่มีข้อสรุปสุดท้ายในเคส — ต้องรอผลทดสอบจากทีมฝั่ง Mobile App (ปิด Imperva แล้วทดสอบ) ก่อน เนื่องจากเป็นความรับผิดชอบของทีม Mobile App ที่ต้องหา Solution ร่วมกับ KTC ต่อไป ฝั่งเว็บไซต์เพียงช่วยพิสูจน์ว่าไม่ได้เกิดจาก Splash Page ของเว็บ

### หน้าเว็บขึ้น Cookie Console Warning
Root Cause: ยังไม่มีข้อสรุปสุดท้ายในเคส — ตรวจสอบโค้ดฝั่งเว็บแล้วไม่พบการเรียกใช้ Script ตัวที่แจ้งปัญหาโดยตรงอยู่ในโค้ดของเว็บไซต์เลย คาดว่า Script น่าจะถูกเรียกใช้จากผู้ให้บริการภายนอกอย่าง Cookies Plus หรือเป็น Consent Dialog เก่าที่เคยใช้ร่วมกับ Predictive ซึ่งอาจฝากไฟล์ไว้ที่ Load Balancer จุดอื่นที่ไม่ใช่โค้ดเว็บไซต์โดยตรง
Resolution: ยังไม่มี Resolution ที่ชัดเจนจากฝั่ง Muze โดยตรง — อยู่ระหว่างประสานงานกับทีมที่เกี่ยวข้อง (Cookies Plus / Predictive) เพื่อตรวจสอบว่ามีการ serve script นี้จากที่ใด และ Load Balancer ชี้ไปถูกที่หรือไม่

### รูปแบบวันที่ต้องปรับให้เป็นมาตรฐาน ISO8601 (แยก ค.ศ. และ พ.ศ. ให้ชัดเจน) บน Widget KYC
Root Cause: Widget KYC ของเว็บไซต์เดิมยังไม่ได้ใช้รูปแบบวันที่ตามมาตรฐาน ISO8601 อย่างสมบูรณ์ ทำให้เสี่ยงเกิดความสับสนระหว่างปี ค.ศ. (Gregorian) และ พ.ศ. (Buddhist Era) — หากต้องแก้ไขจะกระทบทั้งเว็บไซต์ในภาพรวม ไม่ใช่แค่จุดเดียว
Resolution: ทีมอัพเดท redbook รวมถึงปรับค่า datePublished และ dateModified ให้เป็นรูปแบบ ISO8601 ที่ถูกต้องบน Environment UAT เรียบร้อยแล้ว

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
