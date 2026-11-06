import { describe, expect, it } from "vitest";
import { categorize, classifyRemedy, emailsIn, isWebmail, parseUnits, unitsBucket } from "@/lib/recall/classify";

/** Real CPSC remedy texts and consumer contacts, copied verbatim from content/recalls/recalls.json. */
const REAL: Record<string, { remedy: string; contact: string }> = {
  "26429": {
    "remedy": "Consumers should stop using and secure the recalled sodium hydroxide product out of sight and reach of children immediately and contact Archie Xpress for a full refund. Consumers will be asked to write \"RECALLED\" on the back of the zip-top pouch and send a photo of the marked pouch to support@archieenterprise.in. Consumers should then dispose of the pellets in accordance with local and state regulations. Note: Consumers should follow local household hazardous waste (HHW) guidance for corrosive solids. Contact your city, county, or state HHW program for instructions, as requirements may differ by location. Recommend safe approach: Keep the product in its package, clearly label it \"DO NOT USE\" and bring it to a local HHW drop-off facility.",
    "contact": "Archie Xpress at 302-261-5337 9 a.m. to 5 p.m. ET Monday through Friday, email at support@archieenterprise.in, or visit www.archieenterprise.in and click \"Recall\" at the top of the homepage for more information."
  },
  "26652": {
    "remedy": "Consumers should stop using the recalled throws and blankets immediately and contact OCTROT for a full refund. Consumers will be asked to destroy the throws and blankets by unplugging the electrical cord and cutting it in half, and to send a photo of the destroyed product, showing the cut electrical cord, to OctrotRecall@gmail.com. Consumers should then dispose of the destroyed recalled products.",
    "contact": "OCTROT toll-free at 800-928-1807 from 9 a.m. to 5 p.m. ET Monday through Friday, email at OctrotRecall@gmail.com or online at www.Octroct.com/recall for more information."
  },
  "26754": {
    "remedy": "Consumers should unplug and stop using the recalled hair dryers immediately and contact Guang Zhou to receive a full refund. Consumers will be asked to cut the power cord and provide a photo of the destroyed product to wantefully@163.com.",
    "contact": "Guang Zhou at wantefully@163.com."
  },
  "26790": {
    "remedy": "Consumers should stop using the fuel containers immediately and contact Hyperfuels for a full refund or a replacement product. Consumers will be asked to destroy the fuel container by writing in permanent maker “RECALLED” on the product and to send a photo to sales@hyperfuels.com. Consumers should then dispose of the recalled product in accordance with local and/or state disposal procedures. Note: Recalled methanol and ethanol fuel should be disposed of in accordance with any local and state regulations, contact your local hazardous waste treatment center or inquire about professional recycling points. Do not dispose of methanol or ethanol in sewers, rainwater pipes or ordinary garbage cans to avoid causing fires or environmental pollution.",
    "contact": "Hyperfuels at 833-496-5100 from 9 a.m. CT to 5 p.m. CT Monday through Friday, email at sales@hyperfuels.com or online at www.hyperfuels.com/pages/product-recall-information or www.Hyperfuels.com and click “Product Recall Information” at the top of the page for more information."
  },
  "27007": {
    "remedy": "Consumers should stop using the recalled lamp immediately, turn it off, and unplug it. Consumers will be asked to cut the cord and provide a photograph of the destroyed lamp, following the instructions at https://www.designsdirectllc.com/recalls/. Designs Direct will issue a full refund to consumers within 15 days of receipt of the photo proof of destruction.",
    "contact": "Designs Direct toll-free at 888-425-9692 between 9 a.m. and 5 p.m. ET, Monday through Friday, or by email at recall@designsdirectllc.com, or online at https://www.designsdirectllc.com/recalls/ or https://www.designsdirectllc.com and click on \"Recalls\" at the top of the page for more information."
  },
  "27045": {
    "remedy": "Consumers should stop using the recalled pajama sets immediately and contact Fashion Brand Apparel for a full refund. Consumers will be asked to cut the pajamas in half and email a photo of the destroyed pajama set to qzh.duaoproductrecall@outlook.com to receive the refund. Consumers should then dispose of the destroyed product.",
    "contact": "Fashion Brand Apparel at qzh.duaoproductrecall@outlook.com."
  },
  "27056": {
    "remedy": "Consumers should stop using the recalled power banks immediately. Consumers who purchased their power banks on Amazon.com from Mitrytech should contact Mitrytech for instructions on how to receive a full refund. To receive a refund, consumers will be required to submit a photo of their recalled power bank with the word “recalled” written on it in permanent marker and confirm disposal of the power bank in accordance with applicable laws and regulations.",
    "contact": "Email at HAIARArecall@outlook.com or online at www.haiara.net/recalls.html or www.haiara.net and click on “Recalls” for more information."
  },
  "27072": {
    "remedy": "Consumers should stop using the recalled sterilizer dryers immediately and contact Baby Brezza Enterprises for a free replacement sterilizer dryer, including shipping at no cost to the consumer. Consumers will be asked to register at https://babybrezza.com/pages/about?view=v3-recalls, complete the recall form, unplug the product, cut the power cord to destroy the sterilizer dryer and upload photos. Send photos of the model number on the label of the dryer the destroyed appliance and the return authorization number to recall@babybrezza.com. After uploading the photos, consumers should dispose of the recalled sterilizer dryers in accordance with local and state ordinances.",
    "contact": "Baby Brezza Enterprises toll-free at 888-527-9824 from 9 a.m. to 5 p.m. ET Monday through Friday, email at recall@babybrezza.com or online at https://babybrezza.com/pages/about?view=v3-recalls and www.babybrezza.com and click \"Product Safety Recall\" at the bottom of the page for more information."
  },
  "27073": {
    "remedy": "Consumers should stop using the BMX bicycles immediately and contact Sanven Technology for a free repair kit. Consumers will be shipped free chain guards, with detailed installation tutorials and provided with after-sales support (such as customer service email) to help solve any issues arising during self-installation.",
    "contact": "Sanven Technology by email at recalling@vevor.com, or online at https://www.vevor.com/pages/Vevor-BMX-Bicycles-Recall or www.vevor.com and click “Recall” at the top of the page for more information."
  }
};

describe("classifyRemedy on real CPSC remedies", () => {
  it("pajama set, cut in half, photo to outlook.com (27045)", () => {
    const f = classifyRemedy(REAL["27045"].remedy, REAL["27045"].contact);
    expect(f).toEqual({ photo: true, refund: true, marker: false, cut: true, email: true, webmail: true });
  });
  it("power bank, \"recalled\" in permanent marker; address only in the consumer contact (27056)", () => {
    const f = classifyRemedy(REAL["27056"].remedy, REAL["27056"].contact);
    expect(f).toMatchObject({ photo: true, refund: true, marker: true, cut: false, email: true, webmail: true });
    expect(classifyRemedy(REAL["27056"].remedy).email).toBe(false);
  });
  it("hair dryer brush, cut the power cord, photo to 163.com (26754)", () => {
    expect(classifyRemedy(REAL["26754"].remedy, REAL["26754"].contact)).toEqual({ photo: true, refund: true, marker: false, cut: true, email: true, webmail: true });
  });
  it("heated throws, cord cut in half, photo to gmail.com (26652)", () => {
    expect(classifyRemedy(REAL["26652"].remedy, REAL["26652"].contact)).toMatchObject({ photo: true, refund: true, cut: true, webmail: true });
  });
  it("the common typo \"permanent maker\" still counts as a marker (26790)", () => {
    expect(REAL["26790"].remedy).toMatch(/permanent maker/i);
    expect(classifyRemedy(REAL["26790"].remedy).marker).toBe(true);
  });
  it("\"DO NOT USE\" marking counts as a marker (26429)", () => {
    expect(classifyRemedy(REAL["26429"].remedy).marker).toBe(true);
  });
  it("photo for a replacement is a photo but not a photo refund (27072)", () => {
    const f = classifyRemedy(REAL["27072"].remedy, REAL["27072"].contact);
    expect(f.photo).toBe(true);
    expect(f.refund).toBe(false);
  });
  it("a repair remedy has no photo or refund (27073)", () => {
    const f = classifyRemedy(REAL["27073"].remedy, REAL["27073"].contact);
    expect(f.photo).toBe(false);
    expect(f.refund).toBe(false);
    expect(f.webmail).toBe(false);
  });
  it("a firm's own domain is not webmail (27007)", () => {
    const f = classifyRemedy(REAL["27007"].remedy, REAL["27007"].contact);
    expect(f.email).toBe(true);
    expect(f.webmail).toBe(false);
  });
});

describe("classifier pieces", () => {
  it("finds every address, lower case, without repeats or trailing dots", () => {
    expect(emailsIn("Email A@Outlook.com. Or a@outlook.com, or recall@firm.co.")).toEqual(["a@outlook.com", "recall@firm.co"]);
  });
  it("webmail is an exact domain match", () => {
    expect(isWebmail("x@163.com")).toBe(true);
    expect(isWebmail("x@vip.163.com")).toBe(false);
    expect(isWebmail("x@vevor.com")).toBe(false);
  });
  it("parses CPSC unit counts", () => {
    expect(parseUnits("About 11,000")).toBe(11000);
    expect(parseUnits("About 25,541 (In addition, about 5,534 sold in Canada)")).toBe(25541);
    expect(parseUnits("About 8.2 million (In addition, about 56,741 were sold in Canada)")).toBe(8_200_000);
    expect(parseUnits("Millions")).toBeNull();
    expect(parseUnits("")).toBeNull();
  });
  it("buckets units", () => {
    expect(unitsBucket(300)).toBe("under 1,000");
    expect(unitsBucket(9_999)).toBe("1,000 to 9,999");
    expect(unitsBucket(49_999)).toBe("10,000 to 49,999");
    expect(unitsBucket(5_900_000)).toBe("1 million or more");
    expect(unitsBucket(null)).toBe("not given");
  });
  it("puts products in plain categories", () => {
    expect(categorize("HAIARA Power Banks Recalled", ["HAIARA Power Banks"])).toBe("Batteries and chargers");
    expect(categorize("DREO Recalls Space Heaters", ["DREO Space Heaters"])).toBe("Heaters");
    expect(categorize("Recalls Pajama Sets", ["Children's Pajama Sets"])).toBe("Sleepwear and clothing");
    expect(categorize("PILLANI Recalls Nursing Pillows", ["PILLANI Nursing Pillows"])).toBe("Baby and nursery");
  });
});
