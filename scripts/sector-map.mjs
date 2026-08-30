// ============================================================
// Sector vocabulary — ek hi taxonomy, taaki hot-sector calc bat na jaye.
//
// Do problem theek karta hai:
//  1. NAAM FRAGMENTATION — universe me 'Auto' (8) aur 'Automobile and Auto
//     Components' (35) ALAG buckets the. 43 stock ka sector 8 aur 35 me tut gaya,
//     dono kamzor. Waise hi Pharma/Healthcare, IT/Information Technology,
//     FMCG/Fast Moving Consumer Goods, Metals/Metals & Mining, Telecom/...
//     SECTOR_ALIAS in sab ko ek canonical naam pe le aata hai.
//  2. 'Other' KA PAHAAD — NSE ki index CSVs sirf ~750 stocks tag karti hain,
//     baaki ~1330 'Other' the aur hot-sector calc unhe SKIP karta hai. Yahoo ke
//     assetProfile se har stock ka industry mila; INDUSTRY_MAP usko isi canonical
//     vocabulary me convert karta hai.
//
// Granularity ka faisla: NSE ke macro naam base hain, lekin wo theme jo creator
// alag se trade karta hai (Defence, Railways, Capital Markets, Electronics/EMS,
// PSU vs Private Banks, NBFC) alag bucket rehte hain — kyunki wo alag chalte hain.
// ============================================================

// purana naam → canonical naam
export const SECTOR_ALIAS = {
  'Auto': 'Automobile and Auto Components',
  'Auto Ancillaries': 'Automobile and Auto Components',
  'Pharma': 'Healthcare',
  'Metals': 'Metals & Mining',
  'FMCG': 'Fast Moving Consumer Goods',
  'IT': 'Information Technology',
  'Telecom': 'Telecommunication',
  'Oil & Gas': 'Oil Gas & Consumable Fuels',
  'Utilities': 'Power',
  'Cement / Infra': 'Construction Materials',
  'Retail / Jewellery': 'Consumer Services',
  'Aviation / Hotels': 'Hotels / Travel',
  'Ports / Shipping': 'Logistics / Shipping',
  'Media Entertainment & Publication': 'Media & Entertainment'
};

export const canon = s => SECTOR_ALIAS[s] || s;

// Yahoo industry → canonical sector
export const INDUSTRY_MAP = {
  // --- textiles ---
  'Textile Manufacturing': 'Textiles',
  'Apparel Manufacturing': 'Textiles',

  // --- chemicals / agri ---
  'Specialty Chemicals': 'Chemicals',
  'Chemicals': 'Chemicals',
  'Agricultural Inputs': 'Agri',
  'Farm Products': 'Agri',

  // --- capital goods / engineering ---
  'Specialty Industrial Machinery': 'Capital Goods',
  'Electrical Equipment & Parts': 'Capital Goods',
  'Metal Fabrication': 'Capital Goods',
  'Farm & Heavy Construction Machinery': 'Capital Goods',
  'Tools & Accessories': 'Capital Goods',
  'Industrial Distribution': 'Capital Goods',
  'Business Equipment & Supplies': 'Capital Goods',
  'Packaging & Containers': 'Capital Goods',
  'Aerospace & Defense': 'Defence',

  // --- construction ---
  'Engineering & Construction': 'Construction',
  'Infrastructure Operations': 'Construction',
  'Building Products & Equipment': 'Construction Materials',
  'Building Materials': 'Construction Materials',

  // --- metals ---
  'Steel': 'Metals & Mining',
  'Aluminum': 'Metals & Mining',
  'Copper': 'Metals & Mining',
  'Other Industrial Metals & Mining': 'Metals & Mining',
  'Coking Coal': 'Metals & Mining',

  // --- auto ---
  'Auto Parts': 'Automobile and Auto Components',
  'Auto Manufacturers': 'Automobile and Auto Components',
  'Auto & Truck Dealerships': 'Automobile and Auto Components',

  // --- healthcare ---
  'Drug Manufacturers - Specialty & Generic': 'Healthcare',
  'Drug Manufacturers - General': 'Healthcare',
  'Biotechnology': 'Healthcare',
  'Medical Care Facilities': 'Healthcare',
  'Diagnostics & Research': 'Healthcare',
  'Medical Instruments & Supplies': 'Healthcare',
  'Medical Devices': 'Healthcare',
  'Health Information Services': 'Healthcare',
  'Healthcare Plans': 'Healthcare',
  'Pharmaceutical Retailers': 'Healthcare',

  // --- financials ---
  'Capital Markets': 'Capital Markets',
  'Asset Management': 'Capital Markets',
  'Financial Data & Stock Exchanges': 'Capital Markets',
  'Credit Services': 'NBFC / Finance',
  'Mortgage Finance': 'NBFC / Finance',
  'Financial Conglomerates': 'Financial Services',
  'Insurance Brokers': 'Financial Services',
  'Banks - Regional': 'Financial Services',

  // --- tech ---
  'Information Technology Services': 'Information Technology',
  'Software - Application': 'Information Technology',
  'Software - Infrastructure': 'Information Technology',
  'Computer Hardware': 'Information Technology',
  'Semiconductors': 'Electronics / EMS',
  'Semiconductor Equipment & Materials': 'Electronics / EMS',
  'Electronic Components': 'Electronics / EMS',
  'Electronics & Computer Distribution': 'Electronics / EMS',
  'Scientific & Technical Instruments': 'Electronics / EMS',
  'Communication Equipment': 'Telecommunication',
  'Telecom Services': 'Telecommunication',
  'Internet Content & Information': 'New Age / Internet',
  'Internet Retail': 'New Age / Internet',

  // --- realty ---
  'Real Estate - Development': 'Realty',
  'Real Estate Services': 'Realty',
  'Real Estate - Diversified': 'Realty',

  // --- consumer ---
  'Packaged Foods': 'Fast Moving Consumer Goods',
  'Confectioners': 'Fast Moving Consumer Goods',
  'Beverages - Wineries & Distilleries': 'Fast Moving Consumer Goods',
  'Beverages - Non-Alcoholic': 'Fast Moving Consumer Goods',
  'Beverages - Brewers': 'Fast Moving Consumer Goods',
  'Household & Personal Products': 'Fast Moving Consumer Goods',
  'Tobacco': 'Fast Moving Consumer Goods',
  'Furnishings, Fixtures & Appliances': 'Consumer Durables',
  'Consumer Electronics': 'Consumer Durables',
  'Luxury Goods': 'Consumer Durables',
  'Footwear & Accessories': 'Consumer Durables',
  'Apparel Retail': 'Consumer Services',
  'Specialty Retail': 'Consumer Services',
  'Department Stores': 'Consumer Services',
  'Home Improvement Retail': 'Consumer Services',
  'Grocery Stores': 'Consumer Services',
  'Food Distribution': 'Consumer Services',
  'Restaurants': 'Consumer Services',
  'Education & Training Services': 'Consumer Services',

  // --- hotels / travel ---
  'Lodging': 'Hotels / Travel',
  'Resorts & Casinos': 'Hotels / Travel',
  'Travel Services': 'Hotels / Travel',
  'Leisure': 'Hotels / Travel',
  'Airports & Air Services': 'Hotels / Travel',

  // --- media ---
  'Entertainment': 'Media & Entertainment',
  'Broadcasting': 'Media & Entertainment',
  'Publishing': 'Media & Entertainment',
  'Advertising Agencies': 'Media & Entertainment',

  // --- power / energy ---
  'Utilities - Regulated Electric': 'Power',
  'Utilities - Renewable': 'Power',
  'Utilities - Independent Power Producers': 'Power',
  'Utilities - Regulated Water': 'Power',
  'Solar': 'Power',
  'Utilities - Regulated Gas': 'Oil Gas & Consumable Fuels',
  'Oil & Gas E&P': 'Oil Gas & Consumable Fuels',
  'Oil & Gas Refining & Marketing': 'Oil Gas & Consumable Fuels',
  'Oil & Gas Equipment & Services': 'Oil Gas & Consumable Fuels',
  'Thermal Coal': 'Oil Gas & Consumable Fuels',

  // --- logistics ---
  'Integrated Freight & Logistics': 'Logistics / Shipping',
  'Marine Shipping': 'Logistics / Shipping',
  'Trucking': 'Logistics / Shipping',
  'Railroads': 'Railways',

  // --- paper / wood ---
  'Paper & Paper Products': 'Forest Materials',
  'Lumber & Wood Production': 'Forest Materials',

  // --- services / misc ---
  'Specialty Business Services': 'Services',
  'Staffing & Employment Services': 'Services',
  'Consulting Services': 'Services',
  'Security & Protection Services': 'Services',
  'Waste Management': 'Services',
  'Pollution & Treatment Controls': 'Services',
  'Rental & Leasing Services': 'Services',
  'Conglomerates': 'Diversified'
  // 'Shell Companies' jaan-bujh ke nahi — wo 'Other' hi rahe
};
