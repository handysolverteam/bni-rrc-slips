-- ============================================================
-- BNI Week Slips — seed data. Run AFTER 001_schema.sql.
-- Safe to re-run (conflict guards on id / meeting_date).
-- ============================================================

-- ---------- Members (74, exported from BNI-RRC) ----------
INSERT INTO public.members (id, name, category) VALUES
  ('002a7190-2368-458d-a330-8e0292ec5a31', 'Usha Kumar', 'Life and Disability Insurance'),
  ('008697eb-9b6f-485b-8773-c58e479b9b84', 'Arminderpal Singh', 'Web Design'),
  ('0d9c32b7-d487-418d-8606-aa54686ca11f', 'Ramlal Sagwal', 'Auto/Car Sales'),
  ('0dc73ee9-f4a1-4a6b-a4ae-30d5307ea773', 'Shalini Chaudhry', 'Travel (Other)'),
  ('0f066c8f-ba4c-4871-b944-43efe70c7b77', 'Rudhir Bhalla', 'Commercial Real Estate'),
  ('0f39460b-dcfc-4fe8-98d7-e9c81f38cc22', 'Sandeep Deshwal', 'Bookkeeping'),
  ('1c4783ae-ec26-4a4b-be16-d118f13003f8', 'Kunal Singh Saini', 'Kitchen Construction'),
  ('230838a6-716a-4559-a575-e9cc4707e097', 'Priyatna Basu', 'Clothing & Accessories Retailer'),
  ('23298b8e-3feb-4945-a62e-1500429c5fb7', 'Neraj K Anand', 'Promotional Products'),
  ('2513799a-710f-4d37-b2d8-f63ef3c74f19', 'Richa Mongia', 'Interior Design - Residential'),
  ('284778e7-541f-408b-a609-76a493692f4f', 'Ribhu Sehgal', 'Solar'),
  ('2e44e7a5-1f31-467c-9a17-0796f6cc2033', 'Rohit Kumar', 'Fire Protection'),
  ('31b8bbaf-fb8a-4454-b716-2bc8842265b3', 'Abhishek Aggarwal', 'Retail (Other)'),
  ('362e69a8-9602-422b-bcac-cc7a0b19fd02', 'Rahul Bajaj', 'Glass'),
  ('41a7663b-2abe-41ac-ba91-9776b17713f9', 'Garima Agarwal', 'Translator/Language Services'),
  ('41af2cf5-2bd9-4803-9f49-b82d2767915e', 'Pramod Aggarwal', 'Electrical Equipment'),
  ('4263c668-fb6a-49e5-a979-593ef5b9cc6e', 'Ambika Gupta', 'Candles'),
  ('489d99cf-1e65-4008-a709-f4ffe28cadb5', 'Ashutosh Nagar', 'Civil Law'),
  ('4955ddde-f14b-466a-87df-4da2fa7a4e6f', 'Vivek Kakar', 'Financial Advisor'),
  ('49d4e07f-7733-40a3-9821-f04f828f7605', 'Ashok Bhasin', 'Pools, Spas & Saunas'),
  ('4e49fddf-7858-4468-b9cb-f6b4fa04a0fb', 'Sanjay Jain', 'General Insurance'),
  ('4ed055b0-04aa-49b0-9d6c-164654a6c741', 'Abhay Goenka', 'Cement/Concrete'),
  ('50058c00-9592-4e3d-881f-c31aef14d86b', 'Divya Shakti Bajaj', 'Windows & Doors'),
  ('5648364b-aa6a-433d-b4dd-3ed03b885445', 'Komal Gupta', 'Human Resources'),
  ('575d1a51-dbce-4d7f-827a-1c8b8b5ed376', 'Rohit Chander Sethi', 'Flooring Retail'),
  ('58be7646-f1c3-4c51-bf04-4cbcea230db3', 'Tanvi Dhamija', 'Branding'),
  ('5bddef32-4b4a-442d-89fb-8834362a658d', 'Pranati Bajaj', 'Home Automation'),
  ('5e549473-c5a3-419b-b42c-04b2667dc018', 'Shubham Pahuja', 'Education Services/Tutor'),
  ('6710549a-dd4d-4c27-9510-dc9446c1b8ce', 'Kompal Bhardwaj', 'Event & Business-Service (Other)'),
  ('69aac749-3992-42eb-8022-7266bc92750c', 'Rushaal Panwar', 'Wedding Planner'),
  ('70cff6ea-cd45-4f2d-a765-1b0f1d4f12a6', 'Pranav Agarwal', 'Lighting Manufacture'),
  ('76003d5c-f199-4f48-aa68-fce921f7a334', 'Viraj Bansal', 'Manufacturing (Other)'),
  ('77987626-f617-4e50-ab42-93f7a42bb64b', 'Dr. Hemesh Thakur', 'Health & Wellness (Other)'),
  ('787b2dfe-9408-4832-808b-062a5fb1172b', 'Jasmeet Singh', 'Computer Software'),
  ('7914aeee-6e2c-4281-b37e-b933d6629fe8', 'Sumit Jain', 'Tiles'),
  ('7a36b405-6609-4507-9353-fd3f1977c5b0', 'Vinu Vishvanathan', 'Social Media'),
  ('7bc975e2-2e29-4e05-81f2-dc5c79089355', 'Keshav Verma', 'HVAC - Heating & Air'),
  ('7ca83d4e-b381-406a-9309-c66200a7d8ca', 'Kajal Gupta', 'Travel (Other)'),
  ('80ad06d3-5ba6-4d8d-9af3-b9bebb931541', 'Ranjan K Sapra', 'Pest Control'),
  ('81981e3a-0f70-495c-b909-efb57cdf0391', 'Dhirendra Kumar Singh', 'Retail (Other)'),
  ('86957a3b-bfb5-48c4-85a5-3e2e46835c4a', 'Rajesh Kumar Agarwal', 'Business Financing'),
  ('885cacac-b875-4233-a8bc-6416671f8c5f', 'Hemant Suri', 'Printer'),
  ('8ae42308-5446-402d-9c1b-ada9fa561ab1', 'Kajal Nagrath', 'Chocolatier'),
  ('8e5da638-e26d-4fdb-b34d-2129557e1e4f', 'Amit Gupta', 'Fine Jewelry'),
  ('902893a5-170a-473b-85d9-cbc98d5ac72f', 'Neha Goel', 'Travel (Other)'),
  ('90524a4e-ad6d-4920-b599-1ee1daa87f6c', 'Monica Singh', 'Vaastu Consultant'),
  ('90653136-7b41-463e-b859-71572b8d5f6c', 'Nitin Sharma- Chef', 'Caterer'),
  ('9d5c160e-380f-44a5-ac5d-3920fb7eee6e', 'Suryaditya Bose', 'Interior Design - Commercial'),
  ('a4153741-cf48-49ae-b186-ecb1b387677e', 'Neeraj Sharma', 'Metal Work'),
  ('a7313ef8-9963-4734-a2ec-b3dd57531084', 'Rahul Matharu', 'Computer & Programming (Other)'),
  ('a88a81e5-9d16-4a4f-9ab7-f158b4d2c9ed', 'Surender Singh Khangura', 'Residential Real Estate Agent'),
  ('b0701c7c-3460-48ff-af65-5c63148dcc9d', 'Rahul Wadhwa', 'Sign Company'),
  ('b19e63b7-a041-4b51-9d17-64dd80511fda', 'Ashwani Kumar', 'Custom Clothing/Tailor'),
  ('b1cd40ee-5b8a-4e1d-b70d-142029cc536a', 'Neelam Yadav', 'Leadership Coach'),
  ('b1e4eab4-61fb-409d-a932-2653ac134418', 'Amit Chandna', 'Apparel'),
  ('c089b68f-a1f3-4234-8a6c-ff806d3bcd8e', 'Chandeep Singh Chhatwal', 'Retail (Other)'),
  ('c17888a8-7ac8-4d42-8fb2-b5361af77805', 'Harshdeep Singh Chowdhary', 'Health & Wellness (Other)'),
  ('cf233c75-b276-4a98-bd03-7a4d311cb1db', 'Arun Ahuja', 'Consumer Loan'),
  ('d2ae8b0e-cd65-44e7-8ad2-951bfe468697', 'Atul Mangal', 'Tax Advisor'),
  ('d5dcb6ae-8acb-411a-8f4d-dd35e5519608', 'Vinod Kumar Khatri', 'Waterproofing-Weatherproofing'),
  ('d861232a-f769-437b-b1af-c6eafdfbcc3e', 'Naveen Aggarwal', 'Retail (Other)'),
  ('db3f83f0-45b6-4286-83b3-9c8c95f2b61d', 'Nishant Tanwar', 'Criminal Defense Law'),
  ('dcb13320-1f5b-4717-aabe-5404cb62a779', 'Amit Bahl', 'Architecture & Engineering (Other)'),
  ('e163db07-c087-44ff-a09d-4c084c85cb0b', 'Rajiv Gupta', 'Architect'),
  ('e3e9ab85-3186-4aa0-9cbc-bcfd7ef7e66d', 'Sunil Bindra', 'Single House Builder'),
  ('e4ade87e-1391-48f8-98a0-daa57e355fb1', 'Nitin Sharma', 'Construction (Other)'),
  ('e559bb66-7a7e-41e9-b825-4e9e586d9f89', 'Amit Tambi', 'Painter'),
  ('eb9e2e41-e2ef-4713-a559-3e9401e3f8f3', 'Abhay Mehta', 'Auto/Car Rental/Leasing'),
  ('f00c6820-eeb2-42d8-a0d6-2d511b1713fe', 'Sunil Vashisht', 'Astrologist'),
  ('f4556030-8d66-4bd0-8ec6-5bb341921f0c', 'Ritu Chauhan', 'Tax Advisor'),
  ('fb1bfd8a-dda8-40b8-a9b4-32367b4890a8', 'Rajesh Kumar Gupta', 'Architecture & Engineering (Other)'),
  ('fbf31fbd-16ee-4beb-954b-bc7a16703566', 'Kunnal Gupta', 'Shutters & Awnings'),
  ('fd2a8a84-a616-4ef8-a9c3-57d0f258157a', 'Amitoj Singh Jolly', 'CCTV'),
  ('ffeab6d6-965f-47df-bfa6-7d484a6b937a', 'Tarun Rajput', 'Dentist')
ON CONFLICT (id) DO NOTHING;

-- Home chapter for seed members (must match NEXT_PUBLIC_CHAPTER_NAME,
-- or the 'BNI Influencer' fallback; keep in sync with 002 migration).
INSERT INTO public.chapters (id, name)
VALUES ('c1000000-0000-4000-8000-000000000001', 'BNI Influencer')
ON CONFLICT (id) DO NOTHING;

UPDATE public.members
SET chapter_id = 'c1000000-0000-4000-8000-000000000001'
WHERE chapter_id IS NULL;

-- ---------- BNI weeks: every Wednesday, Jan 2026 → Dec 2027 ----------
-- Label format matches the app: "7 January 2026 (Week 2)" (ISO week-of-year).
WITH days(d) AS (
  SELECT GENERATE_SERIES(DATE '2026-01-07', DATE '2027-12-31', INTERVAL '1 week')::date
),
numbered AS (
  SELECT d, ROW_NUMBER() OVER (ORDER BY d) AS rn FROM days
)
INSERT INTO public.bni_weeks (label, meeting_date, week_no)
SELECT
  (EXTRACT(DAY FROM d)::int)::text
    || ' ' || TRIM(TO_CHAR(d, 'Month'))
    || ' ' || (EXTRACT(YEAR FROM d)::int)::text
    || ' (Week ' || (EXTRACT(WEEK FROM d)::int)::text || ')',
  d,
  rn
FROM numbered
ON CONFLICT (meeting_date) DO UPDATE
SET label = EXCLUDED.label,
    week_no = EXCLUDED.week_no;

-- Keep week_no gapless across the whole table (e.g. weeks added by imports).
-- Labels are date-derived, so they stay valid regardless of numbering.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY meeting_date) AS rn
  FROM public.bni_weeks
)
UPDATE public.bni_weeks w
SET week_no = r.rn
FROM ranked r
WHERE w.id = r.id;
