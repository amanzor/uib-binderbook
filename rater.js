// ============================================================
//  UIB AUTO RATER — multi-carrier Florida personal auto rater
//  ------------------------------------------------------------
//  Companion app to the UIB Binder Book. Same look, same storage
//  (localStorage + the Supabase cloud-sync layer in supabase.js),
//  same sign-in (agentCredentials / uibCurrentUser).
//
//  Data keys (synced to the cloud automatically by supabase.js):
//    raterCarriers : the carrier list you configure
//    raterQuotes   : saved quotes + their rating results
//  Device-only:
//    raterDraft    : the quote currently being typed (auto-saved)
//    raterDemo     : demo mode on/off
//
//  Carrier rating methods:
//    api    → POST to the Supabase edge function "rate" (see
//             supabase/functions/rate/index.ts), which attaches the
//             credentials you stored as Supabase secrets.
//    portal → opens the carrier site + copies a quote summary
//    manual → you type the premium into the comparison table
// ============================================================
(function () {
    'use strict';

    const SUPABASE_URL  = 'https://jgjmobktucyimupelfxd.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnam1vYmt0dWN5aW11cGVsZnhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NDAxMDYsImV4cCI6MjA5ODUxNjEwNn0.5vClAeHl-Cgo6QH4IW3oDHKQn_DKB3DZef9bN9IP0XQ';
    const RATE_FN       = SUPABASE_URL + '/functions/v1/rate';
    const RATE_TIMEOUT  = 45000;

    // ────────────────────────────────────────────────────────────
    //  Option lists
    // ────────────────────────────────────────────────────────────
    const FL_COUNTIES = ['Alachua','Baker','Bay','Bradford','Brevard','Broward','Calhoun','Charlotte','Citrus','Clay','Collier','Columbia','DeSoto','Dixie','Duval','Escambia','Flagler','Franklin','Gadsden','Gilchrist','Glades','Gulf','Hamilton','Hardee','Hendry','Hernando','Highlands','Hillsborough','Holmes','Indian River','Jackson','Jefferson','Lafayette','Lake','Lee','Leon','Levy','Liberty','Madison','Manatee','Marion','Martin','Miami-Dade','Monroe','Nassau','Okaloosa','Okeechobee','Orange','Osceola','Palm Beach','Pasco','Pinellas','Polk','Putnam','Santa Rosa','Sarasota','Seminole','St. Johns','St. Lucie','Sumter','Suwannee','Taylor','Union','Volusia','Wakulla','Walton','Washington'];
    const STATES = ['FL','AL','AK','AZ','AR','CA','CO','CT','DE','DC','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR'];
    const CARRIERS_PRIOR = ['Progressive','GEICO','State Farm','Allstate','Direct General','Infinity','United Automobile','Ocean Harbor','Responsive','Kingsway','Bristol West','National General','Mercury','Travelers','Liberty Mutual','Safeco','Nationwide','Assurance America','First Acceptance','Security National','Kemper','The General','Dairyland','Foremost','Elephant','Root','Lemonade','Windhaven','Star Casualty','Pearl Holding','Other'];
    const INDUSTRIES = ['Agriculture','Arts & Entertainment','Automotive','Banking & Finance','Construction','Education','Engineering','Food Service / Hospitality','Government / Military','Healthcare','Homemaker','Information Technology','Insurance','Legal','Manufacturing','Real Estate','Retail','Retired','Sales / Marketing','Student','Transportation / Delivery','Unemployed','Other'];
    const YEARS = (() => { const y = []; const now = new Date().getFullYear() + 1; for (let i = now; i >= 1981; i--) y.push(String(i)); return y; })();

    const O = {
        yn: ['No', 'Yes'],
        term: [['6', 'Semi-Annual (6 months)'], ['12', 'Annual (12 months)']],
        payment: ['Installments', 'Paid in Full', 'EFT / Auto-pay'],
        bi: ['None', '10/20', '25/50', '50/100', '100/300', '250/500', '500/500'],
        pd: ['10', '25', '50', '100', '300', '500'],
        pipType: ['Basic', 'Extended'],
        pipDed: ['0', '250', '500', '1000'],
        pipDedOpt: [['NI', 'NI – Named Insured only'], ['NIRR', 'NIRR – Named Insured & Resident Relatives']],
        um: ['No Coverage', '10/20', '25/50', '50/100', '100/300', '250/500'],
        medpay: ['No Coverage', '500', '1000', '2000', '5000', '10000'],
        accDeath: ['No Coverage', '5000', '10000', '25000'],
        contactMethod: ['None', 'Phone', 'Text', 'Email', 'Walk-in'],
        preferred: ['Email', 'Phone', 'Text'],
        leadSource: ['Internet', 'Walk-in', 'Phone', 'Referral', 'Dealer', 'Social Media', 'Returning Client', 'Other'],
        quoteDesc: ['New Business', 'Rewrite', 'Renewal', 'Remarket'],
        language: ['English', 'Spanish', 'Creole', 'Portuguese', 'Other'],
        gender: ['Male', 'Female', 'Non-binary'],
        marital: ['Single', 'Married', 'Divorced', 'Widowed', 'Separated', 'Domestic Partner'],
        relationship: ['Insured', 'Spouse', 'Child', 'Parent', 'Sibling', 'Other Relative', 'Non-relative'],
        driverType: ['Rated', 'Excluded', 'Listed (not rated)'],
        priorLimits: ['10/20', '25/50', '50/100', '100/300', '250/500', 'PIP/PD only', 'None'],
        transfer: ['No Prior Transfer', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5'],
        foreign: ['None', 'Cuba', 'Venezuela', 'Colombia', 'Haiti', 'Mexico', 'Dominican Republic', 'Nicaragua', 'Honduras', 'Brazil', 'Argentina', 'Peru', 'Other'],
        licenseStatus: ['Valid', 'Suspended', 'Revoked', 'Expired', 'Learner Permit', 'Foreign', 'Not Licensed'],
        sr22Reason: ['', 'DUI', 'Reckless Driving', 'Driving Without Insurance', 'Points', 'Other'],
        education: ['High School Diploma', 'No High School', 'Some College', 'Associate Degree', 'Bachelor Degree', 'Master Degree', 'Doctorate', 'Vocational'],
        residenceType: ['Single Family Home', 'Condo', 'Apartment', 'Townhome', 'Mobile Home', 'Duplex', 'Other'],
        residenceStatus: ['Own', 'Rent', 'Live with Parents', 'Other'],
        carType: ['Rated', 'Non-rated'],
        lossPayee: ['None', 'Lienholder', 'Lessor', 'Additional Interest'],
        ded: ['No Covg', '100', '250', '500', '1000', '2000'],
        roadside: ['No Covg', 'Basic', 'Plus'],
        rental: ['No Covg', '20/600', '30/900', '40/1200', '50/1500'],
        usage: ['Pleasure', 'Commute to Work/School', 'Business', 'Farm', 'Delivery / Ride Share'],
        newUsed: ['New', 'Used'],
        antiTheft: ['No Anti-Theft', 'Alarm Only', 'Passive Disabling', 'Active Disabling', 'Alarm + Passive', 'Tracking Device'],
        vehicleType: ['Car', 'Truck', 'SUV', 'Van', 'Motorcycle', 'Other'],
        truckSize: ['N/A', 'Half Ton', 'Three Quarter Ton', 'One Ton', 'Over One Ton'],
        fuel: ['Gas', 'Diesel', 'Hybrid', 'Electric', 'Flex Fuel'],
        airbags: ['No Air Bag', 'Driver Side', 'Both Front', 'Front & Side', 'All'],
        passive: ['No Passive Restraint', 'Automatic Seat Belts', 'Air Bags', 'Both'],
        abs: ['No Anti-Lock', '2 Wheel', '4 Wheel'],
        years: YEARS,
        states: STATES
    };

    // ────────────────────────────────────────────────────────────
    //  Field schema — abstracted from the quoting-system screens
    //  t: text|tel|email|date|number|money|select|yn|ym|check
    // ────────────────────────────────────────────────────────────
    const RESIDENCE_YEARS = [['', '— Select —'], ['0', 'Less than 1 year'], ['1', '1 year'], ['2', '2 years'], ['3', '3 years'], ['4', '4 years'], ['5', '5+ years']];
    const PHONE_TYPES = ['Mobile', 'Home', 'Work'];
    const MAX_PHONES = 3;
    const CLIENT_FIELDS = [
        { k: 'firstName', l: 'First Name / MI', t: 'namemi', mi: 'middleName', req: true, full: 'First Name and Middle Initial' },
        { k: 'lastName', l: 'Last Name', t: 'text', req: true },
        { k: 'address', l: 'Address', t: 'address', req: true, full: 'Address (street, city, state, zip)' },
        { k: 'timeAtResidenceYears', l: 'Time at Residence', t: 'select', opts: RESIDENCE_YEARS, req: true, full: 'Time at Residence (years)' },
        { k: 'priorAddress', l: 'Prior Address', t: 'text', wide: true, showIf: (c) => c.timeAtResidenceYears === '0', full: 'Prior Address (lived at current address less than 1 year)' },
        { k: 'phones', l: 'Phone', t: 'phones', req: true },
        { k: 'email', l: 'Email', t: 'email', wide: true }
    ];
    // Filled by address verification (or parsed from the typed address); not shown as separate inputs.
    const CLIENT_DERIVED = { street: '', city: '', state: 'FL', zip: '', county: '', addressVerified: false, mobilePhone: '', homePhone: '', workPhone: '' };
    const COVERAGE_FIELDS = [
        { k: 'effectiveDate', l: 'Effective Date', t: 'date', req: true },
        { k: 'term', l: 'Policy Term', t: 'select', opts: O.term, def: '6' },
        { k: 'paymentOption', l: 'Payment Option', t: 'select', opts: O.payment },
        { k: 'exclusions', l: 'Exclusions', t: 'number', def: '0', min: 0 },
        { k: 'allowCreditScore', l: 'Allow Credit Score?', t: 'select', opts: ['', 'Yes', 'No'], req: true },
        { k: 'nonOwner', l: 'Non-owner', t: 'yn' },
        { k: 'bi', l: 'Liability BI', t: 'select', opts: ['', ...O.bi], req: true },
        { k: 'pd', l: 'Liability PD', t: 'select', opts: O.pd, def: '10' },
        { k: 'pipType', l: 'PIP Type', t: 'select', opts: O.pipType },
        { k: 'pipDed', l: 'PIP Deductible', t: 'select', opts: O.pipDed },
        { k: 'pipDedOption', l: 'PIP Ded Option', t: 'select', opts: O.pipDedOpt, def: 'NIRR' },
        { k: 'wageLossExclusion', l: 'Wage Loss Exclusion', t: 'yn', def: 'Yes' },
        { k: 'um', l: 'UM BI', full: 'Uninsured Motorist BI', t: 'select', opts: O.um },
        { k: 'umStacked', l: 'UM Stacked', t: 'check' },
        { k: 'medPay', l: 'Medical Payments', t: 'select', opts: O.medpay },
        { k: 'accidentalDeath', l: 'Accidental Death', t: 'select', opts: O.accDeath }
    ];
    const DRIVER_INFO = [
        { k: 'driverType', l: 'Driver Type', t: 'select', opts: O.driverType },
        { k: 'firstName', l: 'First Name / MI', t: 'namemi', mi: 'middleName', req: true, full: 'First Name and Middle Initial' },
        { k: 'lastName', l: 'Last Name', t: 'text', req: true },
        { k: 'dob', l: 'Date of Birth', t: 'date', req: true },
        { k: 'age', l: 'Age', t: 'text', ro: true },
        { k: 'gender', l: 'Gender', t: 'select', opts: ['', ...O.gender], req: true },
        { k: 'marital', l: 'Marital Status', t: 'select', opts: ['', ...O.marital], req: true },
        { k: 'relationship', l: 'Relationship', t: 'select', opts: O.relationship },
        { k: 'dlNumber', l: 'DL Number', t: 'text' },
        { k: 'dlState', l: 'DL State', t: 'select', opts: O.states, def: 'FL' }
    ];
    const hasPrior = (d) => d.priorInsurance === 'Yes';
    // The question that decides whether the Prior Insurance group is shown
    const DRIVER_PRIOR_Q = [
        { k: 'priorInsurance', l: 'Does the client have prior insurance?', t: 'select', opts: ['', 'Yes', 'No'], req: true, wide: true }
    ];
    // Shown only when the answer above is Yes
    const DRIVER_PRIOR = [
        { k: 'timeWithPrior', l: 'Time w/ Prior Ins.', full: 'Time with Prior Insurance', t: 'ym', reqIf: hasPrior },
        { k: 'priorExpiration', l: 'Prior Exp. Date', full: 'Prior Expiration Date', t: 'date', reqIf: hasPrior },
        { k: 'priorInAgency', l: 'Prior In Agency', t: 'yn' },
        { k: 'priorCarrier', l: 'Prior Carrier', full: 'Prior Insurance Carrier', t: 'text', list: 'priorCarriers', reqIf: hasPrior },
        { k: 'priorLimits', l: 'Prior Limits', full: 'Prior Liability Limits', t: 'select', opts: O.priorLimits, def: '25/50' },
        { k: 'priorTransfer', l: 'Transfer Level', full: 'Prior Transfer Level', t: 'select', opts: O.transfer },
        { k: 'parentsPolicy', l: "Parent's Policy", t: 'yn' }
    ];
    const DRIVER_ATTR = [
        { k: 'timeLicensedUS', l: 'Time Licensed U.S.', t: 'ym', def: { y: '5', m: '0' } },
        { k: 'timeLicensedFL', l: 'Time Licensed Florida', t: 'ym', def: { y: '5', m: '0' } },
        { k: 'mvrExperienceUS', l: 'MVR Experience U.S.', t: 'ym', def: { y: '5', m: '0' } },
        { k: 'foreignLicensed', l: 'Foreign Licensed', t: 'select', opts: O.foreign },
        { k: 'foreignExperience', l: 'Foreign Lic. Exp.', full: 'Foreign License Experience', t: 'ym' },
        { k: 'sr22', l: 'SR-22', t: 'yn' },
        { k: 'sr22State', l: 'SR-22 State', t: 'select', opts: O.states, def: 'FL' },
        { k: 'sr22Reason', l: 'SR-22 Reason Filing', t: 'select', opts: O.sr22Reason },
        { k: 'fr44', l: 'FR-44', t: 'yn' },
        { k: 'licenseStatus', l: 'License Status', t: 'select', opts: O.licenseStatus },
        { k: 'timeSinceSuspension', l: 'Since Suspension', full: 'Time Since Suspension', t: 'ym', def: { y: '5', m: '0' } },
        { k: 'violations', l: 'Violations (count)', t: 'number', def: '0', min: 0 },
        { k: 'violationNotes', l: 'Violation / Accident Details', full: 'Violation / Accident Details', t: 'text', wide: true },
        { k: 'industry', l: 'Industry', t: 'text', list: 'industries', req: true },
        { k: 'occupation', l: 'Occupation', t: 'text' },
        { k: 'timeEmployed', l: 'Time Employed', t: 'ym' },
        { k: 'education', l: 'Education Level', t: 'select', opts: ['', ...O.education], req: true },
        { k: 'residenceType', l: 'Residence Type', t: 'select', opts: ['', ...O.residenceType], req: true },
        { k: 'residenceStatus', l: 'Residence Status', t: 'select', opts: ['', ...O.residenceStatus], req: true },
        { k: 'propertyInsurance', l: 'Property Insurance', t: 'yn' },
        { k: 'companionHome', l: 'Companion Home', t: 'yn' },
        { k: 'driversTraining', l: "Driver's Training", t: 'yn' },
        { k: 'accPrevention', l: 'Acc. Prev. Course', full: 'Accident Prevention Course', t: 'yn' }
    ];
    const DRIVER_EXTRA = [
        { k: 'milesToWork', l: 'Miles to Work', t: 'number', def: '0', min: 0 },
        { k: 'occasionalOperator', l: 'Occasional Operator', t: 'yn' }
    ];
    const VEHICLE_INFO = [
        { k: 'carType', l: 'Car Type', t: 'select', opts: O.carType },
        { k: 'vin', l: 'VIN', t: 'text', max: 17, wide: true, vin: true },
        { k: 'year', l: 'Model Year', t: 'select', opts: ['', ...O.years], req: true },
        { k: 'make', l: 'Make', t: 'text', req: true },
        { k: 'model', l: 'Model', t: 'text', req: true },
        { k: 'trim', l: 'Trim / Body', t: 'text' },
        { k: 'plate', l: 'License Plate No.', t: 'text' },
        { k: 'zip', l: 'Garaging Zip', t: 'text', req: true, max: 10 },
        { k: 'county', l: 'Garaging County', t: 'text', list: 'flCounties' },
        { k: 'city', l: 'Garaging City', t: 'text' },
        { k: 'alternateGarage', l: 'Alternate Garage', t: 'yn' },
        { k: 'lossPayeeType', l: 'Loss Payee Type', t: 'select', opts: O.lossPayee },
        { k: 'lossPayeeName', l: 'Lienholder / Lessor', full: 'Lienholder / Lessor Name', t: 'text', wide: true },
        { k: 'comp', l: 'Comp Ded.', full: 'Comprehensive Deductible', t: 'select', opts: O.ded, def: '500' },
        { k: 'coll', l: 'Coll Ded.', full: 'Collision Deductible', t: 'select', opts: O.ded, def: '500' },
        { k: 'roadside', l: 'Roadside', t: 'select', opts: O.roadside },
        { k: 'rental', l: 'Rental', t: 'select', opts: O.rental },
        { k: 'customEquipment', l: 'Custom Equipment ($)', t: 'money' },
        { k: 'gap', l: 'Gap', t: 'yn' },
        { k: 'safetyGlass', l: 'Safety Glass', t: 'yn' }
    ];
    const VEHICLE_ATTR = [
        { k: 'usage', l: 'Usage', t: 'select', opts: ['', ...O.usage], req: true },
        { k: 'rideShare', l: 'Ride Share', t: 'yn' },
        { k: 'primaryOperator', l: 'Primary Operator', t: 'select', opts: [], dynamic: 'drivers' },
        { k: 'percentToWork', l: '% Driven to Work', full: 'Percent Driven to Work', t: 'number', def: '100', min: 0, max: 100 },
        { k: 'telematics', l: 'Telematics', t: 'select', opts: ['', 'Yes', 'No'], req: true },
        { k: 'milesToWork', l: 'Miles to Work', full: 'Miles Driven to Work', t: 'number', def: '0', min: 0 },
        { k: 'annualMiles', l: 'Annual Miles', full: 'Annual Miles Driven', t: 'number', def: '0', min: 0 },
        { k: 'odometer', l: 'Odometer', t: 'number', def: '0', min: 0 },
        { k: 'purchaseCost', l: 'Purchase Cost', t: 'money' },
        { k: 'msrp', l: 'MSRP', t: 'money' },
        { k: 'acv', l: 'ACV', t: 'money' },
        { k: 'purchaseDate', l: 'Purchase Date', t: 'date', req: true },
        { k: 'newUsed', l: 'New / Used', t: 'select', opts: O.newUsed },
        { k: 'leased', l: 'Leased Vehicle', t: 'yn' },
        { k: 'salvaged', l: 'Salvaged', t: 'yn' },
        { k: 'antiTheft', l: 'Anti Theft', t: 'select', opts: O.antiTheft },
        { k: 'greyMarket', l: 'Grey Market', t: 'yn' }
    ];
    const VEHICLE_EXTRA = [
        { k: 'vehicleType', l: 'Vehicle Type', t: 'select', opts: O.vehicleType },
        { k: 'cylinders', l: 'Cylinders', full: 'Number of Cylinders', t: 'number', def: '4', min: 0 },
        { k: 'truckSize', l: 'Truck Size', t: 'select', opts: O.truckSize },
        { k: 'dualie', l: 'Dualie', t: 'yn' },
        { k: 'turbo', l: 'Turbo Charged', t: 'yn' },
        { k: 'fuelType', l: 'Fuel Type', t: 'select', opts: O.fuel },
        { k: 'fourWheelDrive', l: '4-Wheel Drive', full: 'Four Wheel Drive', t: 'yn' },
        { k: 'fourWheelSteering', l: '4-Wheel Steering', full: 'Four Wheel Steering', t: 'yn' },
        { k: 'airBags', l: 'Air Bags', t: 'select', opts: O.airbags },
        { k: 'passiveRestraint', l: 'Passive Restraint', t: 'select', opts: O.passive },
        { k: 'runningLights', l: 'Running Lights', t: 'yn' },
        { k: 'antiLockBrakes', l: 'Anti-lock Brakes', t: 'select', opts: O.abs },
        { k: 'hoodLock', l: 'Hood Lock', full: 'Hood Locking Device', t: 'yn' },
        { k: 'homingDevice', l: 'Homing Device', t: 'yn' },
        { k: 'vinEtching', l: 'VIN Etching', t: 'yn' }
    ];

    const DRIVER_FIELDS = [...DRIVER_INFO, ...DRIVER_PRIOR_Q, ...DRIVER_PRIOR, ...DRIVER_ATTR, ...DRIVER_EXTRA];
    const VEHICLE_FIELDS = [...VEHICLE_INFO, ...VEHICLE_ATTR, ...VEHICLE_EXTRA];

    // ────────────────────────────────────────────────────────────
    //  State
    // ────────────────────────────────────────────────────────────
    let quote = null;            // the quote being edited
    let results = [];            // current rating results
    let carriers = [];           // configured carriers
    let currentUser = '';
    let demo = false;
    let deferredInstall = null;
    let draftTimer = null;

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const uid = () => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const money = (n) => (n == null || n === '' || isNaN(n)) ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

    function load(key, fallback) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    }
    function save(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); return true; }
        catch (e) { showError('Could not save — this device\'s storage is full. Delete old saved quotes and try again.'); return false; }
    }

    function blankRecord(fields) {
        const r = {};
        fields.forEach((f) => {
            if (f.t === 'ym') { r[f.k + 'Years'] = f.def ? f.def.y : '0'; r[f.k + 'Months'] = f.def ? f.def.m : '0'; }
            else if (f.t === 'namemi') { r[f.k] = ''; r[f.mi] = ''; }
            else if (f.t === 'check') r[f.k] = false;
            else if (f.t === 'yn') r[f.k] = f.def || 'No';
            else if (f.t === 'select') r[f.k] = f.def != null ? f.def : optValue(f.opts && f.opts[0]);
            else r[f.k] = f.def != null ? f.def : '';
        });
        return r;
    }
    function optValue(o) { return o == null ? '' : (Array.isArray(o) ? o[0] : o); }

    function blankQuote() {
        const q = {
            id: uid(),
            createdAt: new Date().toISOString(),
            updatedAt: null,
            agent: currentUser,
            client: Object.assign(blankRecord(CLIENT_FIELDS), CLIENT_DERIVED, { phones: [{ type: 'Mobile', number: '' }] }),
            coverages: blankRecord(COVERAGE_FIELDS),
            drivers: [blankRecord(DRIVER_FIELDS)],
            vehicles: [blankRecord(VEHICLE_FIELDS)]
        };
        q.coverages.effectiveDate = todayISO();
        q.drivers[0].relationship = 'Insured';
        q.vehicles[0].primaryOperator = '1';
        return q;
    }

    // path helpers: "client.zip", "drivers.0.dob"
    function getPath(obj, path) {
        return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    }
    function setPath(obj, path, val) {
        const parts = String(path).split('.');
        let o = obj;
        for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; }
        o[parts[parts.length - 1]] = val;
    }

    // ────────────────────────────────────────────────────────────
    //  Form rendering
    // ────────────────────────────────────────────────────────────
    function fieldHTML(f, base, rec) {
        const path = base + '.' + f.k;
        const id = 'f_' + path.replace(/\./g, '_');
        const label = '<label for="' + id + '" title="' + esc(f.full || f.l) + '">' + esc(f.l) + (f.req || f.reqIf ? '<span class="req">*</span>' : '') + '</label>';
        const cls = 'form-group' + (f.wide ? ' wide' : '');
        let ctrl = '';
        const v = rec[f.k];
        if (f.t === 'select') {
            let opts = f.opts;
            if (f.dynamic === 'drivers') opts = quote.drivers.map((d, i) => [String(i + 1), 'Driver ' + (i + 1) + (d.firstName ? ' – ' + d.firstName : '')]);
            ctrl = '<select id="' + id + '" data-path="' + path + '"' + (f.req ? ' data-req="1"' : '') + '>' +
                opts.map((o) => { const val = optValue(o); const lab = Array.isArray(o) ? o[1] : (o === '' ? '— Select —' : o);
                    return '<option value="' + esc(val) + '"' + (String(val) === String(v == null ? '' : v) ? ' selected' : '') + '>' + esc(lab) + '</option>'; }).join('') +
                '</select>';
        } else if (f.t === 'yn') {
            ctrl = '<select id="' + id + '" data-path="' + path + '">' + O.yn.map((o) => '<option' + (o === v ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
        } else if (f.t === 'namemi') {
            ctrl = '<div class="pair namemi">' +
                '<input type="text" id="' + id + '" data-path="' + path + '" value="' + esc(v) + '" placeholder="First" autocomplete="given-name"' + (f.req ? ' data-req="1"' : '') + '>' +
                '<input type="text" class="mi" data-path="' + base + '.' + f.mi + '" value="' + esc(rec[f.mi]) + '" maxlength="2" placeholder="MI" title="Middle initial" autocomplete="additional-name"></div>';
        } else if (f.t === 'ym') {
            ctrl = '<div class="pair ym">' +
                '<input type="number" min="0" max="99" inputmode="numeric" data-path="' + path + 'Years" value="' + esc(rec[f.k + 'Years']) + '" title="Years"' + (f.req || f.reqIf ? ' data-req="1"' : '') + '><span>yr</span>' +
                '<input type="number" min="0" max="11" inputmode="numeric" data-path="' + path + 'Months" value="' + esc(rec[f.k + 'Months']) + '" title="Months"><span>mo</span></div>';
        } else if (f.t === 'address') {
            const c = rec;
            return '<div class="form-group wide3" data-showif="' + f.k + '"><label for="' + id + '" title="' + esc(f.full || f.l) + '">' + esc(f.l) + '<span class="req">*</span></label>' +
                '<div class="pair addr"><input type="text" id="' + id + '" data-path="' + path + '" value="' + esc(c.address) + '" placeholder="8420 NW 52nd St, Doral, FL 33166" autocomplete="street-address" data-req="1">' +
                '<button type="button" class="btn-success btn-sm" id="verifyAddrBtn" style="flex:0 0 auto;" onclick="Rater.verifyAddress()"><i data-lucide="map-pin-check"></i> Verify</button></div>' +
                '<div class="addr-status' + (c.addressVerified ? ' ok' : '') + '" id="addrStatus">' + addressStatusText(c) + '</div></div>';
        } else if (f.t === 'phones') {
            return '<div class="form-group wide" id="phonesGroup"><label title="Phone numbers">' + esc(f.l) + '<span class="req">*</span></label><div id="phonesWrap">' + phonesHTML(rec) + '</div></div>';
        } else if (f.t === 'check') {
            ctrl = '<div class="check"><input type="checkbox" id="' + id + '" data-path="' + path + '"' + (v ? ' checked' : '') + '><label for="' + id + '" style="margin:0;font-weight:500;">' + esc(f.l) + '</label></div>';
            return '<div class="' + cls + '"><label>&nbsp;</label>' + ctrl + '</div>';
        } else {
            const type = f.t === 'money' ? 'number' : f.t;
            const extra = (f.t === 'money' ? ' inputmode="decimal" step="0.01" min="0" placeholder="0.00"' : '') +
                (f.t === 'number' ? ' inputmode="numeric"' + (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') : '') +
                (f.t === 'tel' ? ' inputmode="tel" placeholder="(305) 555-1234" maxlength="14"' : '') +
                (f.t === 'text' && f.max ? ' maxlength="' + f.max + '"' : '') +
                (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') +
                (f.list ? ' list="' + f.list + '"' : '') +
                (f.ro ? ' readonly tabindex="-1"' : '') +
                (f.reqIf ? ' data-req="1"' : '') +
                (f.vin ? ' style="text-transform:uppercase;font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:1px;"' : '') +
                (f.req ? ' data-req="1"' : '');
            ctrl = '<input type="' + type + '" id="' + id + '" data-path="' + path + '" value="' + esc(v) + '"' + extra + '>';
            if (f.vin) {
                ctrl = '<div class="pair">' + ctrl + '<button type="button" class="btn-success btn-sm" style="flex:0 0 auto;" onclick="Rater.decodeVin(\'' + base + '\')"><i data-lucide="search"></i> Lookup</button></div>';
            }
        }
        return '<div class="' + cls + '"' + (f.showIf ? ' data-showif="' + f.k + '"' : '') + '>' + label + ctrl + '</div>';
    }

    function phonesHTML(c) {
        const phones = c.phones && c.phones.length ? c.phones : [{ type: 'Mobile', number: '' }];
        return phones.map((p, i) => '<div class="pair phone-row">' +
            '<select data-path="client.phones.' + i + '.type" style="flex:0 0 92px;">' + PHONE_TYPES.map((t) => '<option' + (t === p.type ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
            '<input type="tel" inputmode="tel" data-path="client.phones.' + i + '.number" value="' + esc(p.number) + '" placeholder="(305) 555-1234" maxlength="14"' + (i === 0 ? ' data-req="1"' : '') + '>' +
            (i > 0 ? '<button type="button" class="btn-danger btn-xs" title="Remove this phone" onclick="Rater.removePhone(' + i + ')">✕</button>' : '') +
            (i === phones.length - 1 && phones.length < MAX_PHONES ? '<button type="button" class="btn-primary btn-xs" title="Add another phone" onclick="Rater.addPhone()">+</button>' : '') +
            '</div>').join('');
    }
    function addressStatusText(c) {
        if (c.addressVerified) return '✔ Verified · ' + esc([c.city, c.state, c.zip].filter(Boolean).join(', ')) + (c.county ? ' · ' + esc(c.county) + ' County' : '');
        if (c.zip) return 'Not verified · using ' + esc([c.city, c.state, c.zip].filter(Boolean).join(', ')) + ' as typed. Press Verify to confirm.';
        return 'Type the full address (street, city, state, zip) and press Verify.';
    }
    // Hide / show fields with a showIf rule (e.g. Prior Address only when < 1 year at residence)
    function applyShowIf() {
        CLIENT_FIELDS.forEach((f) => { if (!f.showIf) return; document.querySelectorAll('[data-showif="' + f.k + '"]').forEach((el) => { el.style.display = f.showIf(quote.client) ? '' : 'none'; }); });
    }

    function gridHTML(fields, base, rec) {
        return '<div class="form-grid">' + fields.map((f) => fieldHTML(f, base, rec)).join('') + '</div>';
    }

    function sectionHTML(id, icon, title, inner, opts) {
        opts = opts || {};
        return '<div class="form-section' + (opts.collapsible ? ' collapsible' : '') + (opts.collapsed ? ' collapsed' : '') + '" id="sec_' + id + '">' +
            '<h3' + (opts.collapsible ? ' onclick="this.parentElement.classList.toggle(\'collapsed\')"' : '') + '>' +
            '<i data-lucide="' + icon + '"></i> ' + esc(title) + (opts.sub ? ' <span class="sub">' + esc(opts.sub) + '</span>' : '') +
            '<span class="spacer"></span>' + (opts.right || '') + (opts.collapsible ? '<i data-lucide="chevron-down" class="chev"></i>' : '') +
            '</h3>' + inner + '</div>';
    }

    function driverName(d) { return (d.firstName || d.lastName) ? (d.firstName + ' ' + d.lastName).trim() : ''; }

    // "Driver Information" section: one card per driver with the basics
    function driverHTML(i) {
        const d = quote.drivers[i];
        const base = 'drivers.' + i;
        return '<div class="sub-block" id="driver_' + i + '">' +
            '<h4><i data-lucide="user"></i> Driver #' + (i + 1) + ' <span class="note">' + esc(driverName(d)) + '</span><span class="spacer"></span>' +
            (quote.drivers.length > 1 ? '<button type="button" class="btn-danger btn-xs" onclick="Rater.removeDriver(' + i + ')"><i data-lucide="trash-2"></i> Remove</button>' : '') +
            '</h4>' +
            gridHTML(DRIVER_INFO, base, d) +
            '</div>';
    }

    // Prior Insurance card: the yes/no question, then the prior-insurance fields when Yes
    function driverPriorHTML(i) {
        const d = quote.drivers[i];
        const base = 'drivers.' + i;
        return '<div class="sub-block" id="driverprior_' + i + '">' +
            '<h4><i data-lucide="shield-check"></i> Prior Insurance</h4>' +
            gridHTML(DRIVER_PRIOR_Q, base, d) +
            '<div id="driverpriorfields_' + i + '" style="margin-top:10px;' + (hasPrior(d) ? '' : 'display:none;') + '">' + gridHTML(DRIVER_PRIOR, base, d) + '</div>' +
            '</div>';
    }

    // Driver Attributes card: licensing, record, occupation, residence + the folded Additional Attributes
    function driverAttrHTML(i) {
        const d = quote.drivers[i];
        const base = 'drivers.' + i;
        return '<div class="sub-block" id="driverattr_' + i + '">' +
            '<h4><i data-lucide="sliders-horizontal"></i> Driver Attributes</h4>' +
            gridHTML(DRIVER_ATTR, base, d) +
            subGroup('list-plus', 'Additional Attributes', DRIVER_EXTRA, base, d, true) +
            '</div>';
    }

    // One vertical column per driver: information card, then Prior Insurance, then Driver Attributes
    function driverColumnHTML(i) {
        return '<div class="driver-col" id="drivercol_' + i + '">' + driverHTML(i) + driverPriorHTML(i) + driverAttrHTML(i) + '</div>';
    }

    function vehicleHTML(i) {
        const v = quote.vehicles[i];
        const base = 'vehicles.' + i;
        const name = (v.year || v.make || v.model) ? [v.year, v.make, v.model].filter(Boolean).join(' ') : '';
        return '<div class="sub-block" id="vehicle_' + i + '">' +
            '<h4><i data-lucide="car"></i> Car #' + (i + 1) + ' <span class="note">' + esc(name) + '</span><span class="spacer"></span>' +
            (quote.vehicles.length > 1 ? '<button type="button" class="btn-danger btn-xs" onclick="Rater.removeVehicle(' + i + ')"><i data-lucide="trash-2"></i> Remove</button>' : '') +
            '</h4>' +
            gridHTML(VEHICLE_INFO, base, v) +
            subGroup('sliders-horizontal', 'Vehicle Attributes', VEHICLE_ATTR, base, v, false) +
            subGroup('list-plus', 'Additional Attributes', VEHICLE_EXTRA, base, v, true) +
            '</div>';
    }

    // A collapsible group of fields inside a driver / vehicle card.
    // Groups that hold a required field always start open.
    function subGroup(icon, title, fields, base, rec, startCollapsed) {
        const collapsed = startCollapsed && !fields.some((f) => f.req);
        return '<div class="sub-group' + (collapsed ? ' collapsed' : '') + '">' +
            '<h4 style="margin-top:12px;" onclick="this.parentElement.classList.toggle(\'collapsed\')"><i data-lucide="' + icon + '"></i> ' + esc(title) +
            ' <span class="count">' + fields.length + ' fields</span><i data-lucide="chevron-down" class="chev"></i></h4>' +
            gridHTML(fields, base, rec) + '</div>';
    }

    function datalists() {
        const dl = (id, arr) => '<datalist id="' + id + '">' + arr.map((a) => '<option value="' + esc(a) + '">').join('') + '</datalist>';
        return dl('flCounties', FL_COUNTIES) + dl('priorCarriers', CARRIERS_PRIOR) + dl('industries', INDUSTRIES);
    }

    function renderForm() {
        const form = $('quoteForm');
        form.innerHTML =
            datalists() +
            sectionHTML('client', 'user', 'Client Contact Information', gridHTML(CLIENT_FIELDS, 'client', quote.client)) +
            sectionHTML('coverages', 'shield', 'General Information / Coverages', gridHTML(COVERAGE_FIELDS, 'coverages', quote.coverages)) +
            sectionHTML('drivers', 'users', 'Drivers',
                '<div class="repeat-head"><span class="title">Drivers: ' + quote.drivers.length + '</span><span class="note">each column is one driver: information, prior insurance, attributes</span></div>' +
                '<div class="card-row"><div class="cards" id="driversWrap">' + quote.drivers.map((_, i) => driverColumnHTML(i)).join('') + '</div>' +
                '<button type="button" class="add-card" onclick="Rater.addDriver()" title="Add another driver"><span class="plus">+</span><span>Add Driver</span></button></div>', { sub: 'information, prior insurance, attributes' }) +
            sectionHTML('vehicles', 'car', 'Vehicle Information',
                '<div class="repeat-head"><span class="title">Cars: ' + quote.vehicles.length + '</span><span class="spacer"></span>' +
                '<button type="button" class="btn-primary btn-sm" onclick="Rater.addVehicle()"><i data-lucide="plus"></i> Add Vehicle</button></div>' +
                '<div id="vehiclesWrap">' + quote.vehicles.map((_, i) => vehicleHTML(i)).join('') + '</div>') +
            '<div style="text-align:center;margin:6px 0 10px;"><button type="button" class="btn-secondary btn-sm" onclick="Rater.showKeys()"><i data-lucide="key"></i> Show field keys (for carrier templates)</button></div>';
        markRequired();
        applyShowIf();
        updateMeta();
        refreshIcons();
    }

    function updateMeta() {
        const el = $('quoteMeta');
        if (!el) return;
        const who = [quote.client.firstName, quote.client.lastName].filter(Boolean).join(' ');
        el.textContent = (who ? who + ' · ' : '') + 'Quote ' + quote.id.slice(-6).toUpperCase() + (quote.updatedAt ? ' · saved ' + new Date(quote.updatedAt).toLocaleString('en-US') : ' · not saved yet');
    }

    function markRequired() {
        document.querySelectorAll('#quoteForm [data-req]').forEach((el) => {
            el.classList.toggle('need', el.value === '' || el.value == null);
        });
    }

    function onFieldChange(el) {
        const path = el.dataset.path;
        if (!path) return;
        let val = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'tel') { val = formatPhone(val); el.value = val; }
        if (/\.vin$/.test(path)) { val = String(val).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, ''); el.value = val; }
        if (/\.middleName$/.test(path)) { val = String(val).toUpperCase().slice(0, 2); el.value = val; }
        setPath(quote, path, val);
        if (el.dataset.req != null) el.classList.toggle('need', val === '');

        // Derived values
        const m = path.match(/^drivers\.(\d+)\.(\w+)$/);
        if (m) {
            const i = +m[1];
            if (m[2] === 'priorInsurance') { const g = $('driverpriorfields_' + i); if (g) g.style.display = hasPrior(quote.drivers[i]) ? '' : 'none'; }
            if (m[2] === 'dob') { quote.drivers[i].age = ageFrom(val); const a = document.querySelector('[data-path="drivers.' + i + '.age"]'); if (a) a.value = quote.drivers[i].age; }
            if (m[2] === 'firstName' || m[2] === 'lastName') {
                document.querySelectorAll('#driver_' + i + ' > h4 .note, #driverprior_' + i + ' > h4 .note, #driverattr_' + i + ' > h4 .note').forEach((h) => { h.textContent = driverName(quote.drivers[i]); });
                refreshOperatorSelects();
            }
        }
        const mv = path.match(/^vehicles\.(\d+)\.(year|make|model)$/);
        if (mv) { const i = +mv[1]; const v = quote.vehicles[i]; const h = document.querySelector('#vehicle_' + i + ' h4 .note'); if (h) h.textContent = [v.year, v.make, v.model].filter(Boolean).join(' '); }
        if (path === 'client.firstName' || path === 'client.lastName') updateMeta();
        if (path === 'client.address') { quote.client.addressVerified = false; parseAddress(val); setAddrStatus(); }
        if (path === 'client.timeAtResidenceYears') applyShowIf();
        if (/^client\.phones\./.test(path)) derivePhones();
        scheduleDraft();
    }

    function refreshOperatorSelects() {
        document.querySelectorAll('[data-path$=".primaryOperator"]').forEach((sel) => {
            const cur = sel.value;
            sel.innerHTML = quote.drivers.map((d, i) => '<option value="' + (i + 1) + '">Driver ' + (i + 1) + (d.firstName ? ' – ' + esc(d.firstName) : '') + '</option>').join('');
            sel.value = cur || '1';
        });
    }

    function ageFrom(dob) {
        if (!dob) return '';
        const b = new Date(dob); if (isNaN(b)) return '';
        const n = new Date(); let a = n.getFullYear() - b.getFullYear();
        if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
        return a >= 0 && a < 120 ? String(a) : '';
    }

    function formatPhone(v) {
        const d = String(v || '').replace(/\D/g, '').slice(0, 10);
        if (d.length < 4) return d;
        if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
        return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    }

    // ── Address: one line, verified against OpenStreetMap (Nominatim) ──
    // Best-effort parse of "street, city, ST 12345" so rating can proceed even unverified.
    function parseAddress(text) {
        const c = quote.client;
        const t = String(text || '').trim();
        c.street = ''; c.city = ''; c.zip = ''; c.county = '';
        const m = t.match(/^(.*?),\s*([^,]+?),?\s+([A-Za-z]{2})\.?,?\s+(\d{5})(?:-\d{4})?\s*$/);
        if (m) { c.street = m[1].trim(); c.city = m[2].trim(); c.state = m[3].toUpperCase(); c.zip = m[4]; return; }
        const z = t.match(/(\d{5})(?:-\d{4})?\s*$/); if (z) c.zip = z[1];
        const st = t.match(/\b([A-Za-z]{2})\.?,?\s+\d{5}/); if (st && STATES.includes(st[1].toUpperCase())) c.state = st[1].toUpperCase();
        c.street = t.split(',')[0].trim();
    }
    function setAddrStatus(extra, cls) {
        const el = $('addrStatus'); if (!el) return;
        el.className = 'addr-status' + (cls ? ' ' + cls : quote.client.addressVerified ? ' ok' : '');
        el.innerHTML = extra || addressStatusText(quote.client);
    }
    function copyGarageFromClient() {
        const c = quote.client; const v = quote.vehicles[0]; if (!v) return;
        [['zip', 'zip'], ['county', 'county'], ['city', 'city']].forEach(([ck, vk]) => {
            if (c[ck] && !v[vk]) { v[vk] = c[ck]; const el = document.querySelector('[data-path="vehicles.0.' + vk + '"]'); if (el) { el.value = c[ck]; el.classList.remove('need'); } }
        });
    }
    // "52 st" → "52nd St", "ne 3 ave" → "NE 3rd Ave": the geocoder wants ordinal street numbers.
    function normalizeStreet(text) {
        const ord = (n) => { const x = +n, m = x % 100; return n + ((m >= 11 && m <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[x % 10] || 'th')); };
        return String(text)
            .replace(/\b(\d+)\s+(st|street|ave|avenue|ter|terrace|pl|place|ct|court|ln|lane|rd|road|dr|drive|way|blvd|boulevard|cir|circle|pkwy|parkway|hwy|highway)\b/gi, (m, n, t) => ord(n) + ' ' + t)
            .replace(/\b(nw|ne|sw|se)\b/gi, (m) => m.toUpperCase());
    }
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    let verifying = false;
    async function nominatim(params) {
        const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams(Object.assign({ format: 'jsonv2', addressdetails: '1', countrycodes: 'us', limit: '1' }, params));
        const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const arr = await r.json();
        return arr && arr[0] && arr[0].address && arr[0].address.house_number ? arr[0] : null;
    }
    async function verifyAddress() {
        const c = quote.client;
        const q = String(c.address || '').trim();
        if (q.length < 8) { setAddrStatus('Type the full address first (street, city, state, zip).', 'warn'); return; }
        if (verifying) return; verifying = true;
        const btn = $('verifyAddrBtn'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Verifying'; }
        setAddrStatus('<span class="spinner dark"></span> Checking address…', '');
        try {
            // Try as typed, then with ordinal street numbers, then as a structured query — one request per second (service limit).
            parseAddress(q);
            const attempts = [{ q }];
            const nq = normalizeStreet(q); if (nq !== q) attempts.push({ q: nq });
            if (c.street && c.zip) attempts.push({ street: normalizeStreet(c.street), postalcode: c.zip, state: c.state || 'FL', country: 'us' });
            else if (c.street && c.city) attempts.push({ street: normalizeStreet(c.street), city: c.city, state: c.state || 'FL', country: 'us' });
            let hit = null;
            for (let i = 0; i < attempts.length && !hit; i++) { if (i) await sleep(1100); hit = await nominatim(attempts[i]); }
            const a = hit && hit.address;
            if (!a) { parseAddress(q); setAddrStatus('✖ Address not found. Check the spelling and zip, or keep it as typed.', 'warn'); return; }
            const street = [a.house_number, a.road].filter(Boolean).join(' ');
            const city = a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || '';
            const state = (a['ISO3166-2-lvl4'] || '').replace(/^US-/, '') || c.state || 'FL';
            const zip = (a.postcode || '').slice(0, 5);
            const county = (a.county || '').replace(/\s+County$/i, '');
            if (!a.house_number || !zip) { parseAddress(q); if (county) c.county = county; if (!c.city && city) c.city = city; setAddrStatus('⚠ Found the street but not the exact house number — kept as typed' + (c.zip ? ' (zip ' + esc(c.zip) + ')' : '') + '. Double-check the number.', 'warn'); return; }
            c.street = street; c.city = city; c.state = state; c.zip = zip; c.county = county; c.addressVerified = true;
            c.address = street + ', ' + city + ', ' + state + ' ' + zip;
            const inp = document.querySelector('[data-path="client.address"]'); if (inp) { inp.value = c.address; inp.classList.remove('need'); }
            setAddrStatus();
            copyGarageFromClient();
            scheduleDraft();
        } catch (e) {
            parseAddress(q);
            setAddrStatus('⚠ Could not reach the address service — kept as typed' + (c.zip ? ' (zip ' + esc(c.zip) + ')' : '') + '.', 'warn');
        } finally {
            verifying = false;
            if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="map-pin-check"></i> Verify'; refreshIcons(); }
        }
    }

    // ── Phones ───────────────────────────────────────────────────
    function derivePhones() {
        const c = quote.client; const ph = c.phones || [];
        const first = (t) => { const p = ph.find((x) => x.type === t && x.number); return p ? p.number : ''; };
        c.mobilePhone = first('Mobile') || (ph[0] && ph[0].number) || '';
        c.homePhone = first('Home'); c.workPhone = first('Work');
    }
    function renderPhones() { const w = $('phonesWrap'); if (w) w.innerHTML = phonesHTML(quote.client); markRequired(); }
    function addPhone() {
        const ph = quote.client.phones; if (ph.length >= MAX_PHONES) return;
        const used = ph.map((p) => p.type); ph.push({ type: PHONE_TYPES.find((t) => !used.includes(t)) || 'Mobile', number: '' });
        renderPhones(); const last = document.querySelector('[data-path="client.phones.' + (ph.length - 1) + '.number"]'); if (last) last.focus(); scheduleDraft();
    }
    function removePhone(i) { quote.client.phones.splice(i, 1); if (!quote.client.phones.length) quote.client.phones.push({ type: 'Mobile', number: '' }); derivePhones(); renderPhones(); scheduleDraft(); }

    // VIN decode via the free NHTSA vPIC service (no credentials needed)
    async function decodeVin(base) {
        const idx = +base.split('.')[1];
        const v = quote.vehicles[idx];
        const vin = String(v.vin || '').toUpperCase().trim();
        if (vin.length !== 17) { showError('Enter the full 17-character VIN first.'); return; }
        showSuccess('<span class="spinner dark"></span> Looking up VIN…');
        try {
            const r = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + encodeURIComponent(vin) + '?format=json');
            const j = await r.json();
            const d = j.Results && j.Results[0];
            if (!d || !d.Make) throw new Error('No match');
            const set = (k, val) => { if (val) { v[k] = val; const el = document.querySelector('[data-path="' + base + '.' + k + '"]'); if (el) { el.value = val; el.classList.remove('need'); } } };
            set('year', d.ModelYear);
            set('make', titleCase(d.Make));
            set('model', d.Model);
            set('trim', [d.Trim, d.BodyClass].filter(Boolean).join(' / '));
            if (d.EngineCylinders) set('cylinders', d.EngineCylinders);
            if (d.FuelTypePrimary) set('fuelType', /diesel/i.test(d.FuelTypePrimary) ? 'Diesel' : /electric/i.test(d.FuelTypePrimary) ? 'Electric' : /hybrid/i.test(d.ElectrificationLevel || '') ? 'Hybrid' : /flex|e85/i.test(d.FuelTypePrimary) ? 'Flex Fuel' : 'Gas');
            if (d.DriveType && /4wd|awd|4x4|all/i.test(d.DriveType)) set('fourWheelDrive', 'Yes');
            if (d.ABS && /standard|yes/i.test(d.ABS)) set('antiLockBrakes', '4 Wheel');
            if (d.AirBagLocFront) set('airBags', d.AirBagLocSide ? 'Front & Side' : 'Both Front');
            if (d.BodyClass) set('vehicleType', /pickup|truck/i.test(d.BodyClass) ? 'Truck' : /suv|sport utility|crossover/i.test(d.BodyClass) ? 'SUV' : /van/i.test(d.BodyClass) ? 'Van' : /motorcycle/i.test(d.BodyClass) ? 'Motorcycle' : 'Car');
            if (d.Turbo && /yes/i.test(d.Turbo)) set('turbo', 'Yes');
            const h = document.querySelector('#vehicle_' + idx + ' h4 .note'); if (h) h.textContent = [v.year, v.make, v.model].filter(Boolean).join(' ');
            showSuccess('VIN decoded: ' + esc([v.year, v.make, v.model].filter(Boolean).join(' ')));
            scheduleDraft();
        } catch (e) {
            showError('Could not decode that VIN. Check it and try again, or type the year/make/model.');
        }
    }
    function titleCase(s) { return String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }

    // ────────────────────────────────────────────────────────────
    //  Drivers / vehicles
    // ────────────────────────────────────────────────────────────
    function addDriver() {
        const d = blankRecord(DRIVER_FIELDS);
        d.relationship = quote.drivers.length === 1 ? 'Spouse' : 'Child';
        // copy household-level answers from driver 1 so the agent doesn't retype them
        const d1 = quote.drivers[0];
        ['priorInsurance', 'timeWithPriorYears', 'timeWithPriorMonths', 'priorExpiration', 'priorCarrier', 'priorLimits', 'residenceType', 'residenceStatus', 'propertyInsurance', 'lastName'].forEach((k) => { if (d1[k] != null) d[k] = d1[k]; });
        quote.drivers.push(d);
        renderForm();
        setTimeout(() => { const el = $('drivercol_' + (quote.drivers.length - 1)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' }); }, 50);
        scheduleDraft();
    }
    function removeDriver(i) {
        if (quote.drivers.length <= 1) return;
        if (!confirm('Remove Driver #' + (i + 1) + '?')) return;
        quote.drivers.splice(i, 1);
        quote.vehicles.forEach((v) => { if (+v.primaryOperator > quote.drivers.length) v.primaryOperator = '1'; });
        renderForm(); scheduleDraft();
    }
    function addVehicle() {
        const v = blankRecord(VEHICLE_FIELDS);
        const v1 = quote.vehicles[0];
        ['zip', 'county', 'city', 'comp', 'coll', 'roadside', 'rental'].forEach((k) => { if (v1[k] != null) v[k] = v1[k]; });
        v.primaryOperator = String(Math.min(quote.vehicles.length + 1, quote.drivers.length));
        quote.vehicles.push(v);
        renderForm();
        setTimeout(() => { const el = $('vehicle_' + (quote.vehicles.length - 1)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
        scheduleDraft();
    }
    function removeVehicle(i) {
        if (quote.vehicles.length <= 1) return;
        if (!confirm('Remove Car #' + (i + 1) + '?')) return;
        quote.vehicles.splice(i, 1);
        renderForm(); scheduleDraft();
    }

    // ────────────────────────────────────────────────────────────
    //  Draft / new / sample
    // ────────────────────────────────────────────────────────────
    function scheduleDraft() {
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => { try { (window.uibCloud ? window.uibCloud.rawSet : localStorage.setItem.bind(localStorage))('raterDraft', JSON.stringify(quote)); } catch (e) {} }, 400);
    }
    function newQuote() {
        if (quote && hasContent() && !confirm('Start a new quote? Unsaved changes to the current quote will be lost.')) return;
        quote = blankQuote(); results = [];
        renderForm(); renderResults(); showTab('quote');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        scheduleDraft();
    }
    function hasContent() { return !!(quote.client.firstName || quote.client.lastName || quote.client.mobilePhone || quote.vehicles[0].vin); }

    function fillSample() {
        if (hasContent() && !confirm('Replace the current quote with sample data?')) return;
        quote = blankQuote();
        Object.assign(quote.client, { firstName: 'Maria', middleName: 'L', lastName: 'Gonzalez', address: '8420 NW 52nd St, Doral, FL 33166', street: '8420 NW 52nd St', zip: '33166', county: 'Miami-Dade', city: 'Doral', state: 'FL', addressVerified: false, timeAtResidenceYears: '3', phones: [{ type: 'Mobile', number: '(305) 555-0147' }], email: 'maria.gonzalez@example.com' });
        derivePhones();
        Object.assign(quote.coverages, { bi: '25/50', pd: '25', allowCreditScore: 'Yes', um: '25/50', medPay: '1000' });
        Object.assign(quote.drivers[0], { firstName: 'Maria', middleName: 'L', lastName: 'Gonzalez', dob: '1988-04-12', age: ageFrom('1988-04-12'), gender: 'Female', marital: 'Married', dlNumber: 'G524-310-88-634-0', priorInsurance: 'Yes', timeWithPriorYears: '2', timeWithPriorMonths: '6', priorExpiration: todayISO(), priorCarrier: 'Progressive', industry: 'Healthcare', occupation: 'Nurse', timeEmployedYears: '4', education: 'Bachelor Degree', residenceType: 'Single Family Home', residenceStatus: 'Own', propertyInsurance: 'Yes' });
        Object.assign(quote.vehicles[0], { vin: '1HGCV1F34LA012345', year: '2020', make: 'Honda', model: 'Accord', trim: 'EX / Sedan', zip: '33166', county: 'Miami-Dade', city: 'Doral', usage: 'Commute to Work/School', telematics: 'No', milesToWork: '12', annualMiles: '12000', odometer: '41000', purchaseDate: '2021-06-15', newUsed: 'Used', lossPayeeType: 'Lienholder', lossPayeeName: 'Honda Financial Services', airBags: 'Front & Side', antiLockBrakes: '4 Wheel', passiveRestraint: 'Air Bags', runningLights: 'Yes' });
        results = [];
        renderForm(); renderResults(); scheduleDraft();
        showSuccess('Sample quote loaded. Turn on Demo mode on the Carriers tab, then press Rate Quote.');
    }

    // ────────────────────────────────────────────────────────────
    //  Validation
    // ────────────────────────────────────────────────────────────
    function validate() {
        markRequired();
        const missing = [];
        const check = (fields, rec, label) => fields.forEach((f) => {
            if (!(f.req || (f.reqIf && f.reqIf(rec)))) return;
            const v = f.t === 'ym' ? rec[f.k + 'Years'] : rec[f.k];
            if (v === '' || v == null) missing.push(label + f.l);
        });
        const c = quote.client;
        if (!c.firstName) missing.push('First Name');
        if (!c.lastName) missing.push('Last Name');
        if (!c.address) missing.push('Address');
        else if (!c.zip) missing.push('Address zip code (press Verify or type "street, city, FL zip")');
        if (c.timeAtResidenceYears === '' || c.timeAtResidenceYears == null) missing.push('Time at Residence');
        if (!(c.phones && c.phones.some((p) => p.number && p.number.replace(/\D/g, '').length === 10))) missing.push('Phone (10 digits)');
        check(COVERAGE_FIELDS, quote.coverages, '');
        quote.drivers.forEach((d, i) => check(DRIVER_FIELDS, d, 'Driver ' + (i + 1) + ': '));
        quote.vehicles.forEach((v, i) => check(VEHICLE_FIELDS, v, 'Car ' + (i + 1) + ': '));
        return missing;
    }

    // ────────────────────────────────────────────────────────────
    //  Carriers
    // ────────────────────────────────────────────────────────────
    function loadCarriers() {
        carriers = load('raterCarriers', []);
        if (!Array.isArray(carriers)) carriers = [];
        carriers.sort((a, b) => (+a.order || 0) - (+b.order || 0) || String(a.name).localeCompare(String(b.name)));
    }
    function saveCarriers() { save('raterCarriers', carriers); renderCarriers(); }

    function renderCarriers() {
        const list = $('carrierList');
        const badge = $('carriersBadge');
        if (badge) { badge.textContent = carriers.filter((c) => c.enabled).length; badge.style.display = carriers.length ? '' : 'none'; }
        if (!carriers.length) {
            list.innerHTML = '<div class="empty" style="grid-column:1/-1;"><i data-lucide="building-2"></i>No carriers yet. Press <b>Add Carrier</b> to add the companies you rate with.<br><br>' +
                '<button class="btn-secondary btn-sm" onclick="Rater.addStarterCarriers()"><i data-lucide="sparkles"></i> Add a starter list (manual entry)</button></div>';
            refreshIcons(); return;
        }
        list.innerHTML = carriers.map((c) => {
            const method = c.method || 'api';
            return '<div class="carrier-card' + (c.enabled ? '' : ' off') + '" style="border-left-color:' + esc(c.color || '#1d4ed8') + ';">' +
                '<div class="name">' + esc(c.name) + ' <span class="pill">' + esc(c.code) + '</span></div>' +
                '<div class="row"><span class="pill ' + method + '">' + (method === 'api' ? 'API' : method === 'portal' ? 'Portal' : 'Manual') + '</span>' +
                '<span class="pill ' + (c.enabled ? 'on' : 'off') + '">' + (c.enabled ? 'Enabled' : 'Disabled') + '</span>' +
                (method === 'api' && c.secretPrefix ? '<span class="pill">RATER_' + esc(c.secretPrefix) + '_*</span>' : '') + '</div>' +
                (method === 'api' && c.endpoint ? '<div class="meta">' + esc(c.endpoint) + '</div>' : '') +
                (method === 'portal' && c.portalUrl ? '<div class="meta">' + esc(c.portalUrl) + '</div>' : '') +
                (c.notes ? '<div class="note">' + esc(c.notes) + '</div>' : '') +
                '<div class="row" style="margin-top:4px;">' +
                '<button class="btn-primary btn-xs" onclick="Rater.editCarrier(\'' + esc(c.id) + '\')"><i data-lucide="pencil"></i> Edit</button>' +
                (method === 'api' ? '<button class="btn-secondary btn-xs" onclick="Rater.testCarrier(\'' + esc(c.id) + '\')"><i data-lucide="activity"></i> Test connection</button>' : '') +
                '<button class="btn-secondary btn-xs" onclick="Rater.toggleCarrier(\'' + esc(c.id) + '\')">' + (c.enabled ? 'Disable' : 'Enable') + '</button>' +
                '</div></div>';
        }).join('');
        refreshIcons();
    }

    function addStarterCarriers() {
        const names = ['Progressive', 'GEICO', 'Direct General', 'Infinity', 'United Automobile', 'Ocean Harbor', 'Responsive', 'Kingsway', 'Bristol West', 'National General'];
        const colors = ['#1d4ed8', '#059669', '#dc2626', '#7c3aed', '#d97706', '#0891b2', '#be123c', '#4338ca', '#15803d', '#b45309'];
        names.forEach((n, i) => {
            if (carriers.some((c) => c.name.toLowerCase() === n.toLowerCase())) return;
            carriers.push({ id: uid(), name: n, code: n.replace(/[^A-Z]/gi, '').slice(0, 5).toUpperCase(), method: 'manual', enabled: true, color: colors[i % colors.length], order: (i + 1) * 10, notes: '' });
        });
        saveCarriers();
        showSuccess('Starter carriers added as manual entry. Edit each one to switch it to API or Portal rating.');
    }

    function editCarrier(id) {
        const c = id ? carriers.find((x) => x.id === id) : null;
        $('carrierModalTitle').innerHTML = '<i data-lucide="building-2"></i> ' + (c ? 'Edit Carrier' : 'Add Carrier');
        $('c_id').value = c ? c.id : '';
        $('c_name').value = c ? c.name : '';
        $('c_code').value = c ? c.code : '';
        $('c_method').value = c ? (c.method || 'api') : 'api';
        $('c_enabled').value = c ? (c.enabled ? '1' : '0') : '1';
        $('c_color').value = c && c.color ? c.color : '#1d4ed8';
        $('c_order').value = c && c.order != null ? c.order : (carriers.length + 1) * 10;
        $('c_portalUrl').value = c ? (c.portalUrl || '') : '';
        $('c_endpoint').value = c ? (c.endpoint || '') : '';
        $('c_httpMethod').value = c ? (c.httpMethod || 'POST') : 'POST';
        $('c_contentType').value = c ? (c.contentType || 'json') : 'json';
        $('c_authType').value = c ? (c.authType || 'none') : 'none';
        $('c_apiKeyHeader').value = c ? (c.apiKeyHeader || '') : '';
        $('c_secretPrefix').value = c ? (c.secretPrefix || '') : '';
        $('c_requestTemplate').value = c ? (c.requestTemplate || '') : '';
        const m = (c && c.responseMap) || {};
        $('c_mapPremium').value = m.premium || ''; $('c_mapDown').value = m.downPayment || ''; $('c_mapMonthly').value = m.monthly || '';
        $('c_mapTerm').value = m.term || ''; $('c_mapQuoteId').value = m.quoteId || ''; $('c_mapLink').value = m.link || ''; $('c_mapError').value = m.error || '';
        $('c_notes').value = c ? (c.notes || '') : '';
        $('c_deleteBtn').style.display = c ? '' : 'none';
        carrierMethodChanged();
        $('carrierModal').classList.add('open');
        refreshIcons();
        setTimeout(() => $('c_name').focus(), 50);
    }
    function carrierMethodChanged() {
        const m = $('c_method').value;
        $('c_apiFields').style.display = m === 'api' ? '' : 'none';
        $('c_portalFields').style.display = m === 'portal' ? '' : 'none';
    }
    function closeCarrier() { $('carrierModal').classList.remove('open'); }
    function saveCarrier() {
        const name = $('c_name').value.trim();
        const code = $('c_code').value.trim().toUpperCase();
        if (!name || !code) { alert('Carrier name and short code are required.'); return; }
        const id = $('c_id').value || uid();
        const c = {
            id, name, code,
            method: $('c_method').value,
            enabled: $('c_enabled').value === '1',
            color: $('c_color').value,
            order: +$('c_order').value || 0,
            portalUrl: $('c_portalUrl').value.trim(),
            endpoint: $('c_endpoint').value.trim(),
            httpMethod: $('c_httpMethod').value,
            contentType: $('c_contentType').value,
            authType: $('c_authType').value,
            apiKeyHeader: $('c_apiKeyHeader').value.trim(),
            secretPrefix: $('c_secretPrefix').value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
            requestTemplate: $('c_requestTemplate').value,
            responseMap: { premium: $('c_mapPremium').value.trim(), downPayment: $('c_mapDown').value.trim(), monthly: $('c_mapMonthly').value.trim(), term: $('c_mapTerm').value.trim(), quoteId: $('c_mapQuoteId').value.trim(), link: $('c_mapLink').value.trim(), error: $('c_mapError').value.trim() },
            notes: $('c_notes').value.trim()
        };
        if (c.method === 'api' && c.requestTemplate.trim() && c.contentType === 'json') {
            // Sanity-check the template is JSON once placeholders are filled with dummies
            try { JSON.parse(c.requestTemplate.replace(/\{\{json:[^}]+\}\}/g, '[]').replace(/\{\{[^}]+\}\}/g, 'x')); }
            catch (e) { if (!confirm('The request template is not valid JSON after filling placeholders:\n' + e.message + '\n\nSave anyway?')) return; }
        }
        const i = carriers.findIndex((x) => x.id === id);
        if (i >= 0) carriers[i] = c; else carriers.push(c);
        carriers.sort((a, b) => (+a.order || 0) - (+b.order || 0) || String(a.name).localeCompare(String(b.name)));
        saveCarriers(); closeCarrier();
        showSuccess('Carrier "' + esc(name) + '" saved.');
    }
    function deleteCarrier() {
        const id = $('c_id').value; const c = carriers.find((x) => x.id === id); if (!c) return;
        if (!confirm('Delete carrier "' + c.name + '"?')) return;
        carriers = carriers.filter((x) => x.id !== id);
        saveCarriers(); closeCarrier();
    }
    function toggleCarrier(id) { const c = carriers.find((x) => x.id === id); if (!c) return; c.enabled = !c.enabled; saveCarriers(); }

    function exportCarriers() {
        const blob = new Blob([JSON.stringify(carriers, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'uib-rater-carriers.json'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    function importCarriers() {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
        inp.onchange = () => {
            const f = inp.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = () => {
                try {
                    const arr = JSON.parse(r.result);
                    if (!Array.isArray(arr)) throw new Error('Expected a list of carriers');
                    let added = 0, updated = 0;
                    arr.forEach((c) => { if (!c || !c.name) return; const i = carriers.findIndex((x) => x.id === c.id || x.code === c.code); if (i >= 0) { carriers[i] = Object.assign({}, carriers[i], c); updated++; } else { c.id = c.id || uid(); carriers.push(c); added++; } });
                    saveCarriers(); showSuccess('Imported carriers: ' + added + ' added, ' + updated + ' updated.');
                } catch (e) { showError('Import failed: ' + esc(e.message)); }
            };
            r.readAsText(f);
        };
        inp.click();
    }

    function publicCarrier(c) {
        // what we send to the rating function — never any secret values
        return { id: c.id, name: c.name, code: c.code, method: c.method, endpoint: c.endpoint, httpMethod: c.httpMethod, contentType: c.contentType, authType: c.authType, apiKeyHeader: c.apiKeyHeader, secretPrefix: c.secretPrefix, requestTemplate: c.requestTemplate, responseMap: c.responseMap };
    }

    async function testCarrier(id) {
        const c = carriers.find((x) => x.id === id); if (!c) return;
        showSuccess('<span class="spinner dark"></span> Testing ' + esc(c.name) + '…');
        try {
            const r = await callRateFn(c, quote || blankQuote(), { test: true });
            if (r.ok) showSuccess('✅ ' + esc(c.name) + ': the rating function is reachable and the secrets ' + (r.secretsFound ? 'were found (' + esc(r.secretsFound.join(', ')) + ').' : 'check passed.'));
            else showError('❌ ' + esc(c.name) + ': ' + esc(r.error || 'Unknown error'));
        } catch (e) { showError('❌ ' + esc(c.name) + ': ' + esc(e.message)); }
    }

    // ────────────────────────────────────────────────────────────
    //  Rating
    // ────────────────────────────────────────────────────────────
    async function callRateFn(c, q, extra) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), RATE_TIMEOUT);
        try {
            const res = await fetch(RATE_FN, {
                method: 'POST',
                headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ carrier: publicCarrier(c), quote: q }, extra || {})),
                signal: ctrl.signal
            });
            const text = await res.text();
            let j; try { j = JSON.parse(text); } catch (e) { j = { ok: false, error: 'Bad response from rating function (HTTP ' + res.status + '): ' + text.slice(0, 200) }; }
            if (!res.ok && j.ok == null) j = { ok: false, error: (j.error && j.error.message) || j.error || j.message || ('HTTP ' + res.status) };
            return j;
        } catch (e) {
            if (e.name === 'AbortError') throw new Error('Timed out after ' + (RATE_TIMEOUT / 1000) + 's');
            throw new Error('Could not reach the rating function. Is it deployed? (' + e.message + ')');
        } finally { clearTimeout(t); }
    }

    // Deterministic sample premium so Demo mode gives stable, believable numbers.
    function demoPremium(c, q) {
        let h = 0; const s = c.code + '|' + (q.client.zip || '') + '|' + q.drivers.map((d) => d.dob).join(',') + '|' + q.vehicles.map((v) => v.year + v.make).join(',');
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        const rnd = (h % 1000) / 1000;
        let base = 520;
        const biIdx = Math.max(0, O.bi.indexOf(q.coverages.bi)); base += biIdx * 85;
        base += q.vehicles.length * 310;
        q.vehicles.forEach((v) => { if (v.comp !== 'No Covg') base += 140; if (v.coll !== 'No Covg') base += 260; if (v.rental !== 'No Covg') base += 35; if (v.roadside !== 'No Covg') base += 12; });
        q.drivers.forEach((d) => { const a = +d.age || 35; if (a < 25) base += 420; else if (a > 70) base += 160; if (d.sr22 === 'Yes') base += 150; if (+d.violations > 0) base += 95 * +d.violations; if (d.priorInsurance === 'No') base += 180; });
        if (q.coverages.um !== 'No Coverage') base += 120;
        if (q.coverages.medPay !== 'No Coverage') base += 30;
        const premium = Math.round(base * (0.78 + rnd * 0.55) * 100) / 100;
        const term = +q.coverages.term || 6;
        const down = Math.round(premium * 0.2 * 100) / 100;
        const monthly = Math.round(((premium - down) / (term - 1) + 8) * 100) / 100;
        return { premium, downPayment: down, monthly, term, quoteId: c.code + '-' + String(h).slice(-6) };
    }

    function quoteSummaryText() {
        const q = quote; const c = q.client;
        const lines = [];
        lines.push('UIB AUTO QUOTE — ' + [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' '));
        lines.push(c.address + (c.county ? ' (' + c.county + ' County)' : '') + (c.addressVerified ? ' [verified]' : '') + ' · at residence: ' + (c.timeAtResidenceYears === '0' ? '< 1 yr' : (c.timeAtResidenceYears || '?') + ' yr') + (c.priorAddress && c.timeAtResidenceYears === '0' ? ' · prior: ' + c.priorAddress : ''));
        lines.push('Phone: ' + ((c.phones || []).filter((p) => p.number).map((p) => p.type + ' ' + p.number).join(', ') || '—') + '   Email: ' + (c.email || '—'));
        lines.push('Effective: ' + q.coverages.effectiveDate + '   Term: ' + q.coverages.term + ' mo   Pay: ' + q.coverages.paymentOption + '   Credit: ' + q.coverages.allowCreditScore);
        lines.push('BI ' + q.coverages.bi + ' / PD ' + q.coverages.pd + ' / PIP ' + q.coverages.pipType + ' ded ' + q.coverages.pipDed + ' ' + q.coverages.pipDedOption + (q.coverages.wageLossExclusion === 'Yes' ? ' (wage loss excl.)' : '') + ' / UM ' + q.coverages.um + (q.umStacked ? ' stacked' : '') + ' / MedPay ' + q.coverages.medPay + ' / AD ' + q.coverages.accidentalDeath);
        q.drivers.forEach((d, i) => {
            lines.push('DRIVER ' + (i + 1) + ': ' + [d.firstName, d.lastName].filter(Boolean).join(' ') + ' | DOB ' + d.dob + ' (' + d.age + ') | ' + d.gender + ' / ' + d.marital + ' / ' + d.relationship + ' | DL ' + (d.dlNumber || '—') + ' ' + d.dlState + ' | ' + d.driverType);
            lines.push('   Prior: ' + d.priorInsurance + (d.priorInsurance === 'Yes' ? ' ' + d.priorCarrier + ' ' + d.priorLimits + ' ' + d.timeWithPriorYears + 'y' + d.timeWithPriorMonths + 'm exp ' + d.priorExpiration : '') + ' | Lic US ' + d.timeLicensedUSYears + 'y FL ' + d.timeLicensedFLYears + 'y | ' + d.licenseStatus + (d.sr22 === 'Yes' ? ' SR-22' : '') + (d.fr44 === 'Yes' ? ' FR-44' : '') + ' | Viol ' + d.violations + ' | ' + d.industry + (d.occupation ? '/' + d.occupation : '') + ' | ' + d.education + ' | ' + d.residenceType + ' (' + d.residenceStatus + ')');
        });
        q.vehicles.forEach((v, i) => {
            lines.push('CAR ' + (i + 1) + ': ' + [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') + ' | VIN ' + (v.vin || '—') + ' | Garage ' + v.zip + ' ' + v.city + ' | ' + v.usage + ' | Op: Driver ' + v.primaryOperator);
            lines.push('   Comp ' + v.comp + ' / Coll ' + v.coll + ' / Roadside ' + v.roadside + ' / Rental ' + v.rental + (v.gap === 'Yes' ? ' / GAP' : '') + ' | ' + v.newUsed + ' purch ' + v.purchaseDate + ' | ' + v.lossPayeeType + (v.lossPayeeName ? ' ' + v.lossPayeeName : '') + ' | Miles/yr ' + v.annualMiles + ' | Telematics ' + v.telematics);
        });
        return lines.join('\n');
    }

    async function rate() {
        if (!quote) return;
        const missing = validate();
        if (missing.length) {
            showError('Please complete the required fields: ' + esc(missing.slice(0, 6).join(', ')) + (missing.length > 6 ? ' and ' + (missing.length - 6) + ' more' : ''));
            showTab('quote');
            const first = document.querySelector('#quoteForm .need'); if (first) { const g = first.closest('.sub-group.collapsed'); if (g) g.classList.remove('collapsed'); const sec = first.closest('.form-section.collapsed'); if (sec) sec.classList.remove('collapsed'); first.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            return;
        }
        const active = carriers.filter((c) => c.enabled);
        if (!active.length) { showError('No carriers are enabled. Add carriers on the Carriers tab first.'); showTab('carriers'); return; }

        hideMessages();
        const btn = $('rateBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Rating…';
        const startedAt = Date.now();
        // keep any manual premiums the agent already typed for this quote
        const prevManual = {}; results.forEach((r) => { if (r.method === 'manual' && r.premium != null) prevManual[r.carrierId] = r; });
        results = active.map((c) => ({ carrierId: c.id, name: c.name, code: c.code, color: c.color, method: c.method || 'api', status: 'pending', premium: null, downPayment: null, monthly: null, term: null, quoteId: '', link: c.method === 'portal' ? c.portalUrl : '', error: '', ms: 0 }));
        results.forEach((r) => { if (prevManual[r.carrierId]) Object.assign(r, prevManual[r.carrierId], { status: 'manual' }); });
        showTab('results'); renderResults();

        const jobs = results.map(async (r) => {
            const c = carriers.find((x) => x.id === r.carrierId);
            const t0 = Date.now();
            try {
                if (r.method === 'manual') { if (r.status !== 'manual' || r.premium == null) { r.status = 'manual'; } return; }
                if (r.method === 'portal') { r.status = 'portal'; return; }
                if (demo) {
                    await new Promise((res) => setTimeout(res, 500 + Math.random() * 1500));
                    Object.assign(r, demoPremium(c, quote), { status: 'ok', quoteId: 'DEMO-' + demoPremium(c, quote).quoteId });
                    return;
                }
                const j = await callRateFn(c, quote);
                if (j.ok) { Object.assign(r, { status: 'ok', premium: num(j.premium), downPayment: num(j.downPayment), monthly: num(j.monthly), term: j.term || quote.coverages.term, quoteId: j.quoteId || '', link: j.link || '' }); if (r.premium == null) { r.status = 'error'; r.error = 'Carrier answered but no premium was found. Check the response mapping.'; } }
                else { r.status = 'error'; r.error = j.error || 'Carrier returned an error'; }
            } catch (e) { r.status = 'error'; r.error = e.message; }
            finally { r.ms = Date.now() - t0; renderResults(); }
        });
        await Promise.all(jobs);
        btn.disabled = false; btn.innerHTML = '<i data-lucide="zap"></i> Rate Quote'; refreshIcons();
        quote.ratedAt = new Date().toISOString();
        $('resultsMeta').textContent = 'Rated ' + new Date().toLocaleTimeString('en-US') + ' in ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's' + (demo ? ' · DEMO MODE' : '');
        renderResults();
        // autosave the quote with its results
        saveQuote(true);
    }
    function num(v) { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; }

    function renderResults() {
        const body = $('resultsBody');
        const badge = $('resultsBadge');
        const okCount = results.filter((r) => r.premium != null).length;
        if (badge) { badge.textContent = okCount; badge.style.display = results.length ? '' : 'none'; }
        if (!results.length) {
            body.innerHTML = '<div class="empty"><i data-lucide="bar-chart-2"></i>No results yet. Fill in the quote and press <b>Rate Quote</b>.</div>';
            refreshIcons(); return;
        }
        const ranked = results.slice().sort((a, b) => (a.premium == null) - (b.premium == null) || (a.premium || 0) - (b.premium || 0));
        const best = ranked.find((r) => r.premium != null);
        const premiums = results.filter((r) => r.premium != null).map((r) => r.premium);
        const stats = '<div class="stat-row">' +
            '<div class="stat-card"><div class="label">Carriers rated</div><div class="number">' + okCount + ' / ' + results.length + '</div></div>' +
            '<div class="stat-card"><div class="label">Lowest premium</div><div class="number">' + (best ? money(best.premium) : '—') + '</div><div class="note">' + (best ? esc(best.name) : '') + '</div></div>' +
            '<div class="stat-card"><div class="label">Highest premium</div><div class="number">' + (premiums.length ? money(Math.max.apply(null, premiums)) : '—') + '</div></div>' +
            '<div class="stat-card"><div class="label">Term</div><div class="number">' + esc(quote.coverages.term) + ' mo</div></div>' +
            '</div>';
        const statusCell = (r) => {
            if (r.status === 'pending') return '<span class="spinner dark"></span> Rating…';
            if (r.status === 'error') return '<span class="err" title="' + esc(r.error) + '">⚠ ' + esc(r.error) + '</span>';
            if (r.status === 'portal') return '<span class="pill portal">Portal</span> <span class="note">open &amp; paste summary</span>';
            if (r.status === 'manual') return '<span class="pill manual">Manual</span>';
            return '<span class="pill on">OK</span>' + (r.ms ? ' <span class="note">' + (r.ms / 1000).toFixed(1) + 's</span>' : '');
        };
        const actions = (r) => {
            let a = '';
            if (r.link) a += '<button class="btn-purple btn-xs" onclick="Rater.openPortal(\'' + esc(r.carrierId) + '\')"><i data-lucide="external-link"></i> Open</button> ';
            if (r.premium != null) a += '<button class="btn-success btn-xs" onclick="Rater.select(\'' + esc(r.carrierId) + '\')"><i data-lucide="check"></i> ' + (quote.selectedCarrier === r.carrierId ? 'Selected' : 'Select') + '</button>';
            return a;
        };
        const manualInputs = (r, field, ph) => '<input class="manual-premium" type="number" step="0.01" inputmode="decimal" placeholder="' + ph + '" value="' + (r[field] == null ? '' : r[field]) + '" onchange="Rater.setManual(\'' + esc(r.carrierId) + '\',\'' + field + '\',this.value)">';

        const table = '<table class="results-table"><thead><tr><th>#</th><th>Carrier</th><th>Total Premium</th><th>Down</th><th>Monthly</th><th>Quote #</th><th>Status</th><th></th></tr></thead><tbody>' +
            ranked.map((r, i) => '<tr class="' + (best && r.carrierId === best.carrierId ? 'best' : '') + '">' +
                '<td>' + (i + 1) + '</td>' +
                '<td><b style="color:' + esc(r.color || '#0d1f3c') + ';">' + esc(r.name) + '</b></td>' +
                '<td class="money">' + (r.method === 'manual' || r.status === 'portal' ? manualInputs(r, 'premium', 'Premium') : money(r.premium)) + '</td>' +
                '<td>' + (r.method === 'manual' || r.status === 'portal' ? manualInputs(r, 'downPayment', 'Down') : money(r.downPayment)) + '</td>' +
                '<td>' + (r.method === 'manual' || r.status === 'portal' ? manualInputs(r, 'monthly', 'Monthly') : money(r.monthly)) + '</td>' +
                '<td class="note">' + esc(r.quoteId || '') + '</td>' +
                '<td>' + statusCell(r) + '</td>' +
                '<td style="white-space:nowrap;">' + actions(r) + '</td></tr>').join('') +
            '</tbody></table>';

        const cards = '<div class="result-cards">' + ranked.map((r, i) => '<div class="result-card' + (best && r.carrierId === best.carrierId ? ' best' : '') + '" style="border-left-color:' + esc(r.color || '#1d4ed8') + ';">' +
            '<div style="display:flex;align-items:center;gap:8px;"><span class="pill">' + (i + 1) + '</span><span class="name">' + esc(r.name) + '</span><span style="flex:1"></span>' + statusCell(r) + '</div>' +
            (r.method === 'manual' || r.status === 'portal'
                ? '<div class="kv"><span>Premium</span>' + manualInputs(r, 'premium', 'Premium') + '</div><div class="kv"><span>Down</span>' + manualInputs(r, 'downPayment', 'Down') + '</div><div class="kv"><span>Monthly</span>' + manualInputs(r, 'monthly', 'Monthly') + '</div>'
                : '<div class="big">' + money(r.premium) + '</div><div class="kv"><span>Down payment</span><b>' + money(r.downPayment) + '</b></div><div class="kv"><span>Monthly</span><b>' + money(r.monthly) + '</b></div>' + (r.quoteId ? '<div class="kv"><span>Quote #</span><b>' + esc(r.quoteId) + '</b></div>' : '')) +
            '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">' + actions(r) + '</div></div>').join('') + '</div>';

        body.innerHTML = stats + table + cards;
        refreshIcons();
    }

    function setManual(carrierId, field, value) {
        const r = results.find((x) => x.carrierId === carrierId); if (!r) return;
        r[field] = num(value);
        if (r.method === 'manual') r.status = 'manual';
        if (field === 'premium' && r.premium != null && r.term == null) r.term = quote.coverages.term;
        renderResults();
        saveQuote(true);
    }
    function select(carrierId) {
        quote.selectedCarrier = quote.selectedCarrier === carrierId ? '' : carrierId;
        renderResults();
        saveQuote(true);
    }
    async function openPortal(carrierId) {
        const c = carriers.find((x) => x.id === carrierId); const r = results.find((x) => x.carrierId === carrierId);
        const url = (r && r.link) || (c && c.portalUrl);
        if (!url) { showError('No portal link configured for this carrier.'); return; }
        try { await navigator.clipboard.writeText(quoteSummaryText()); showSuccess('Quote summary copied to clipboard — paste it into ' + esc(c ? c.name : 'the carrier') + ' as you quote.'); } catch (e) { /* clipboard blocked */ }
        window.open(url, '_blank', 'noopener');
    }
    async function copySummary() {
        const text = quoteSummaryText() + '\n\nRESULTS:\n' + results.slice().sort((a, b) => (a.premium == null) - (b.premium == null) || (a.premium || 0) - (b.premium || 0)).map((r) => '  ' + r.name + ': ' + (r.premium != null ? money(r.premium) + ' (down ' + money(r.downPayment) + ', monthly ' + money(r.monthly) + ')' : (r.error || r.status))).join('\n');
        try { await navigator.clipboard.writeText(text); showSuccess('Summary copied to clipboard.'); }
        catch (e) { prompt('Copy the summary:', text); }
    }

    // ────────────────────────────────────────────────────────────
    //  Saved quotes
    // ────────────────────────────────────────────────────────────
    function loadSaved() { const s = load('raterQuotes', []); return Array.isArray(s) ? s : []; }
    function saveQuote(silent) {
        if (!quote) return;
        const saved = loadSaved();
        quote.updatedAt = new Date().toISOString();
        quote.agent = quote.agent || currentUser;
        const rec = { id: quote.id, createdAt: quote.createdAt, updatedAt: quote.updatedAt, agent: quote.agent, quote: JSON.parse(JSON.stringify(quote)), results: JSON.parse(JSON.stringify(results)) };
        const i = saved.findIndex((s) => s.id === quote.id);
        if (i >= 0) saved[i] = rec; else saved.unshift(rec);
        while (saved.length > 400) saved.pop();
        if (save('raterQuotes', saved)) { updateMeta(); renderSaved(); if (!silent) showSuccess('Quote saved' + (window.uibCloud && window.uibCloud.isAuto() ? ' and syncing to the cloud.' : '.')); }
    }
    function renderSaved() {
        const body = $('savedBody'); const badge = $('savedBadge');
        let saved = loadSaved();
        if (badge) { badge.textContent = saved.length; badge.style.display = saved.length ? '' : 'none'; }
        const q = ($('savedSearch').value || '').toLowerCase().trim();
        if (q) saved = saved.filter((s) => JSON.stringify([s.quote.client, s.quote.vehicles.map((v) => v.vin), s.agent]).toLowerCase().includes(q));
        if (!saved.length) { body.innerHTML = '<div class="empty"><i data-lucide="folder-open"></i>' + (q ? 'No saved quotes match.' : 'No saved quotes yet.') + '</div>'; refreshIcons(); return; }
        body.innerHTML = '<div class="saved-list">' + saved.map((s) => {
            const c = s.quote.client; const best = (s.results || []).filter((r) => r.premium != null).sort((a, b) => a.premium - b.premium)[0];
            const sel = s.quote.selectedCarrier ? (s.results || []).find((r) => r.carrierId === s.quote.selectedCarrier) : null;
            return '<div class="saved-item">' +
                '<div><div class="who">' + esc([c.firstName, c.lastName].filter(Boolean).join(' ') || '(no name)') + '</div>' +
                '<div class="when">' + esc(c.mobilePhone || c.homePhone || '') + (c.zip ? ' · ' + esc(c.zip) : '') + ' · ' + s.quote.drivers.length + ' drv / ' + s.quote.vehicles.length + ' car · ' + new Date(s.updatedAt || s.createdAt).toLocaleString('en-US') + (s.agent ? ' · ' + esc(s.agent) : '') + '</div></div>' +
                '<div class="spacer"></div>' +
                (sel ? '<span class="pill on">✔ ' + esc(sel.name) + ' ' + money(sel.premium) + '</span>' : best ? '<span class="pill">best: ' + esc(best.name) + ' ' + money(best.premium) + '</span>' : '<span class="pill">not rated</span>') +
                '<button class="btn-primary btn-xs" onclick="Rater.openSaved(\'' + esc(s.id) + '\')"><i data-lucide="folder-open"></i> Open</button>' +
                '<button class="btn-secondary btn-xs" onclick="Rater.duplicateSaved(\'' + esc(s.id) + '\')"><i data-lucide="copy"></i> Copy</button>' +
                '<button class="btn-danger btn-xs" onclick="Rater.deleteSaved(\'' + esc(s.id) + '\')"><i data-lucide="trash-2"></i></button>' +
                '</div>';
        }).join('') + '</div>';
        refreshIcons();
    }
    function openSaved(id) {
        const s = loadSaved().find((x) => x.id === id); if (!s) return;
        if (quote && hasContent() && quote.id !== id && !confirm('Open this saved quote? Unsaved changes to the current quote will be lost.')) return;
        quote = upgradeQuote(s.quote); results = s.results || [];
        renderForm(); renderResults(); showTab('quote'); scheduleDraft();
        window.scrollTo({ top: 0 });
    }
    function duplicateSaved(id) {
        const s = loadSaved().find((x) => x.id === id); if (!s) return;
        quote = upgradeQuote(s.quote); quote.id = uid(); quote.createdAt = new Date().toISOString(); quote.updatedAt = null; quote.selectedCarrier = ''; quote.ratedAt = null; results = [];
        renderForm(); renderResults(); showTab('quote'); scheduleDraft();
        showSuccess('Copied into a new quote. Change what you need and rate again.');
    }
    function deleteSaved(id) {
        if (!confirm('Delete this saved quote?')) return;
        save('raterQuotes', loadSaved().filter((x) => x.id !== id)); renderSaved();
    }
    // fills in any fields added after a quote was saved
    function upgradeQuote(q) {
        const b = blankQuote();
        const merge = (fields, rec, blank) => { fields.forEach((f) => { if (f.t === 'namemi' && rec[f.mi] == null) rec[f.mi] = ''; if (f.t === 'ym') { if (rec[f.k + 'Years'] == null) rec[f.k + 'Years'] = blank[f.k + 'Years']; if (rec[f.k + 'Months'] == null) rec[f.k + 'Months'] = blank[f.k + 'Months']; } else if (rec[f.k] == null) rec[f.k] = blank[f.k]; }); return rec; };
        q.client = merge(CLIENT_FIELDS, q.client || {}, b.client);
        Object.keys(CLIENT_DERIVED).forEach((k) => { if (q.client[k] == null) q.client[k] = CLIENT_DERIVED[k]; });
        if (!Array.isArray(q.client.phones) || !q.client.phones.length) {
            q.client.phones = [];
            [['Mobile', 'mobilePhone'], ['Home', 'homePhone'], ['Work', 'workPhone']].forEach(([t, k]) => { if (q.client[k]) q.client.phones.push({ type: t, number: q.client[k] }); });
            if (!q.client.phones.length) q.client.phones.push({ type: 'Mobile', number: '' });
        }
        // Older quotes stored street / apt / city / zip separately — fold them into the one-line address.
        if (q.client.address && !/,/.test(q.client.address) && q.client.city) {
            q.client.street = q.client.address;
            q.client.address = q.client.address + (q.client.apt ? ' ' + q.client.apt : '') + ', ' + q.client.city + ', ' + (q.client.state || 'FL') + ' ' + (q.client.zip || '');
        }
        if (q.client.timeAtResidenceYears != null && q.client.timeAtResidenceYears !== '' && +q.client.timeAtResidenceYears > 5) q.client.timeAtResidenceYears = '5';
        q.coverages = merge(COVERAGE_FIELDS, q.coverages || {}, b.coverages);
        q.drivers = (q.drivers && q.drivers.length ? q.drivers : [{}]).map((d) => merge(DRIVER_FIELDS, d, b.drivers[0]));
        q.vehicles = (q.vehicles && q.vehicles.length ? q.vehicles : [{}]).map((v) => merge(VEHICLE_FIELDS, v, b.vehicles[0]));
        if (!q.id) q.id = uid();
        return q;
    }
    function exportSaved() {
        const saved = loadSaved();
        if (!saved.length) { showError('Nothing to export yet.'); return; }
        const cols = ['Quote ID', 'Created', 'Agent', 'First Name', 'Last Name', 'Phone', 'Email', 'Zip', 'City', 'Effective', 'BI', 'Drivers', 'Vehicles', 'Vehicle 1', 'VIN 1', 'Best Carrier', 'Best Premium', 'Selected Carrier', 'Selected Premium'];
        const rows = saved.map((s) => { const c = s.quote.client; const v = s.quote.vehicles[0] || {}; const ok = (s.results || []).filter((r) => r.premium != null).sort((a, b) => a.premium - b.premium); const best = ok[0]; const sel = (s.results || []).find((r) => r.carrierId === s.quote.selectedCarrier);
            return [s.id, s.createdAt, s.agent, c.firstName, c.lastName, c.mobilePhone || c.homePhone, c.email, c.zip, c.city, s.quote.coverages.effectiveDate, s.quote.coverages.bi, s.quote.drivers.length, s.quote.vehicles.length, [v.year, v.make, v.model].filter(Boolean).join(' '), v.vin, best ? best.name : '', best ? best.premium : '', sel ? sel.name : '', sel ? sel.premium : '']; });
        const csv = [cols].concat(rows).map((r) => r.map((x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"').join(',')).join('\r\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'uib-rater-quotes.csv'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    // ────────────────────────────────────────────────────────────
    //  Field keys reference
    // ────────────────────────────────────────────────────────────
    function showKeys() {
        const lines = [];
        const add = (prefix, fields) => fields.forEach((f) => { if (f.t === 'ym') { lines.push(prefix + f.k + 'Years'); lines.push(prefix + f.k + 'Months'); } else if (f.t === 'namemi') { lines.push(prefix + f.k + '   (First Name)'); lines.push(prefix + f.mi + '   (Middle Initial)'); } else lines.push(prefix + f.k + '   (' + (f.full || f.l) + ')'); });
        lines.push('# client');
        lines.push('client.firstName', 'client.middleName', 'client.lastName', 'client.address   (full one-line address)', 'client.street', 'client.city', 'client.state', 'client.zip', 'client.county', 'client.addressVerified', 'client.timeAtResidenceYears   (0 = less than 1, 5 = 5+)', 'client.priorAddress', 'client.email');
        lines.push('client.phones.0.type   (Mobile / Home / Work)', 'client.phones.0.number', 'client.mobilePhone', 'client.homePhone', 'client.workPhone   (derived from phones)');
        lines.push('', '# coverages'); add('coverages.', COVERAGE_FIELDS);
        lines.push('', '# drivers.N  (N = 0,1,2…)'); add('drivers.0.', DRIVER_FIELDS);
        lines.push('', '# vehicles.N'); add('vehicles.0.', VEHICLE_FIELDS);
        lines.push('', '# whole arrays / objects (raw JSON)', 'json:drivers', 'json:vehicles', 'json:client', 'json:coverages', 'json:quote');
        lines.push('', '# credentials (filled by the rating function from Supabase secrets)', 'USERNAME  PASSWORD  APIKEY  TOKEN');
        $('keysBody').textContent = lines.join('\n');
        $('keysModal').classList.add('open');
    }

    // ────────────────────────────────────────────────────────────
    //  UI helpers
    // ────────────────────────────────────────────────────────────
    function showTab(name) {
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
        document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
        $('actionBar').style.display = (name === 'quote' || name === 'results') ? '' : 'none';
        if (name === 'saved') renderSaved();
        if (name === 'carriers') renderCarriers();
        hideMessages();
    }
    let msgTimer = null;
    function showSuccess(html) { const e = $('successMessage'); const x = $('errorMessage'); x.style.display = 'none'; e.innerHTML = html; e.style.display = 'block'; clearTimeout(msgTimer); msgTimer = setTimeout(hideMessages, 6000); scrollMsg(e); }
    function showError(html) { const e = $('errorMessage'); const s = $('successMessage'); s.style.display = 'none'; e.innerHTML = html; e.style.display = 'block'; clearTimeout(msgTimer); msgTimer = setTimeout(hideMessages, 9000); scrollMsg(e); }
    function hideMessages() { $('successMessage').style.display = 'none'; $('errorMessage').style.display = 'none'; }
    function scrollMsg(el) { const r = el.getBoundingClientRect(); if (r.top < 0 || r.top > window.innerHeight) window.scrollTo({ top: 0, behavior: 'smooth' }); }
    function refreshIcons() { try { if (window.lucide && lucide.createIcons) lucide.createIcons(); } catch (e) {} }
    function applyDensity() {
        let dense = true;
        try { dense = localStorage.getItem('raterDensity') !== 'comfortable'; } catch (e) {}
        document.body.classList.toggle('dense', dense);
        const b = $('densityBtn');
        if (b) { b.innerHTML = dense ? '<i data-lucide="rows-3"></i> Compact' : '<i data-lucide="rows-2"></i> Comfortable'; b.title = dense ? 'Compact spacing — click for a roomier layout' : 'Comfortable spacing — click for a compact layout'; }
    }
    function toggleDensity() {
        const dense = document.body.classList.contains('dense');
        try { (window.uibCloud ? window.uibCloud.rawSet : localStorage.setItem.bind(localStorage))('raterDensity', dense ? 'comfortable' : 'compact'); } catch (e) {}
        applyDensity(); refreshIcons();
    }
    function setDemo(on) { demo = !!on; try { (window.uibCloud ? window.uibCloud.rawSet : localStorage.setItem.bind(localStorage))('raterDemo', demo ? '1' : '0'); } catch (e) {} if (demo) showSuccess('Demo mode ON — Rate Quote returns sample premiums without contacting any carrier.'); }

    // ────────────────────────────────────────────────────────────
    //  Sign-in (same credentials as the Binder Book)
    // ────────────────────────────────────────────────────────────
    function credentials() { return load('agentCredentials', null); }
    function agentNames() { const c = credentials(); return c && typeof c === 'object' ? Object.keys(c).sort() : []; }
    function showLogin() {
        $('loginGate').style.display = ''; $('app').style.display = 'none';
        const names = agentNames();
        const sel = $('loginAgent');
        sel.innerHTML = names.length ? names.map((n) => '<option>' + esc(n) + '</option>').join('') : '<option value="">(loading agents…)</option>';
        try { const r = localStorage.getItem('rememberedAgentEmail'); if (r && names.includes(r)) sel.value = r; } catch (e) {}
        $('loginMsg').innerHTML = names.length ? '' : 'Agent list not on this device yet. It downloads automatically from the cloud the first time — if this stays empty, sign in on the Binder Book once, then come back.';
        if (!names.length) { let tries = 0; const t = setInterval(() => { tries++; const n = agentNames(); if (n.length) { clearInterval(t); showLogin(); } else if (tries > 20) clearInterval(t); }, 1500); }
        refreshIcons();
    }
    function login() {
        const agent = $('loginAgent').value; const pass = $('loginPassword').value;
        const creds = credentials();
        if (!agent || !creds) { $('loginMsg').innerHTML = '<span style="color:var(--red)">Agent list not loaded yet.</span>'; return; }
        const stored = typeof creds[agent] === 'object' ? (creds[agent] && creds[agent].password) : creds[agent];
        if (stored !== pass) { $('loginMsg').innerHTML = '<span style="color:var(--red)">Incorrect password.</span>'; $('loginPassword').value = ''; return; }
        try { localStorage.setItem('uibCurrentUser', agent); sessionStorage.setItem('uibCurrentUser', agent); } catch (e) {}
        currentUser = agent;
        boot();
    }
    function signedInUser() {
        try { return localStorage.getItem('uibCurrentUser') || sessionStorage.getItem('uibCurrentUser') || ''; } catch (e) { return ''; }
    }

    // ────────────────────────────────────────────────────────────
    //  PWA install
    // ────────────────────────────────────────────────────────────
    function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
    function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream; }
    function setupInstall() {
        if ('serviceWorker' in navigator) { navigator.serviceWorker.register('rater-sw.js').catch(() => {}); }
        window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (!isStandalone() && localStorage.getItem('raterInstallDismissed') !== '1') { $('installBanner').style.display = 'flex'; $('installBtn').style.display = ''; } });
        window.addEventListener('appinstalled', () => { deferredInstall = null; $('installBanner').style.display = 'none'; $('installBtn').style.display = 'none'; showSuccess('Auto Rater installed. Open it from your home screen.'); });
        if (isIOS() && !isStandalone() && localStorage.getItem('raterInstallDismissed') !== '1') { $('installBanner').style.display = 'flex'; $('installBtn').style.display = ''; }
    }
    async function install() {
        if (deferredInstall) { deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (e) {} deferredInstall = null; return; }
        if (isIOS()) { alert('To install on iPhone/iPad:\n\n1. Tap the Share button (square with arrow) in Safari\n2. Scroll and tap "Add to Home Screen"\n3. Tap Add'); return; }
        alert('To install:\n\nChrome / Edge: open the browser menu (⋮) and choose "Install app" or "Add to Home screen".');
    }
    function dismissInstall() { try { localStorage.setItem('raterInstallDismissed', '1'); } catch (e) {} $('installBanner').style.display = 'none'; }

    // ────────────────────────────────────────────────────────────
    //  Boot
    // ────────────────────────────────────────────────────────────
    function boot() {
        currentUser = signedInUser();
        if (!currentUser) { showLogin(); return; }
        $('loginGate').style.display = 'none'; $('app').style.display = '';
        $('userDisplay').textContent = '👤 ' + currentUser;
        demo = (function () { try { return localStorage.getItem('raterDemo') === '1'; } catch (e) { return false; } })();
        $('demoMode').checked = demo;
        loadCarriers();
        const draft = load('raterDraft', null);
        quote = draft && draft.client ? upgradeQuote(draft) : blankQuote();
        if (!quote.agent) quote.agent = currentUser;
        applyDensity();
        renderForm(); renderResults(); renderSaved(); renderCarriers();
        setupInstall();
        refreshIcons();
    }

    document.addEventListener('DOMContentLoaded', () => {
        const form = $('quoteForm');
        form.addEventListener('input', (e) => { if (e.target && e.target.dataset && e.target.dataset.path && e.target.type !== 'checkbox' && e.target.type !== 'tel') onFieldChange(e.target); });
        form.addEventListener('change', (e) => { if (e.target && e.target.dataset && e.target.dataset.path) onFieldChange(e.target); });
        $('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
        document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); }));
        boot();
    });

    window.Rater = {
        showTab, newQuote, fillSample, saveQuote: () => saveQuote(false), rate, decodeVin, addDriver, removeDriver, addVehicle, removeVehicle,
        editCarrier, closeCarrier, saveCarrier, deleteCarrier, toggleCarrier, carrierMethodChanged, exportCarriers, importCarriers, testCarrier, addStarterCarriers, setDemo,
        setManual, select, openPortal, copySummary, renderSaved, openSaved, duplicateSaved, deleteSaved, exportSaved, showKeys,
        login, install, dismissInstall, toggleDensity, verifyAddress, addPhone, removePhone,
        get quote() { return quote; }, get results() { return results; }, get carriers() { return carriers; }
    };
})();
