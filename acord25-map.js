// ============================================================
//  ACORD 25 (2025/12) — CERTIFICATE OF LIABILITY INSURANCE
//  Field map for forms/acord25.pdf
//  ------------------------------------------------------------
//  The PDF in forms/ is the real ACORD AcroForm, byte-identical to
//  the one the agency supplied. We never redraw it: we fill its own
//  129 fields (105 text + 24 checkboxes), so what prints IS the
//  ACORD form, not a lookalike that could drift from the official
//  layout.
//
//  `pdf` on a field is the exact AcroForm field name. `k` is the key
//  under which the AMS stores the value on a certificate record.
//  Section order here is the order the editor renders.
//
//  A certificate is a legal statement of coverage. Nothing here
//  invents a value: a field the agent has not filled stays blank on
//  the printed form.
// ============================================================

(function () {
    'use strict';

    // Money fields print right-aligned next to a "$" already drawn on
    // the form, so values are stored plain and formatted on the way out.
    var T = 'text', D = 'date', M = 'textarea', C = 'check', YN = 'yn';

    // ── Producer (the agency) ────────────────────────────────
    var PRODUCER = { id: 'producer', title: 'Producer (agency)', cols: 2, fields: [
        { k: 'prodName',    label: 'Agency name',      type: T, pdf: 'Producer_FullName_A', wide: true },
        { k: 'prodAddr1',   label: 'Address line 1',   type: T, pdf: 'Producer_MailingAddress_LineOne_A', wide: true },
        { k: 'prodAddr2',   label: 'Address line 2',   type: T, pdf: 'Producer_MailingAddress_LineTwo_A', wide: true },
        { k: 'prodCity',    label: 'City',             type: T, pdf: 'Producer_MailingAddress_CityName_A' },
        { k: 'prodState',   label: 'State',            type: T, pdf: 'Producer_MailingAddress_StateOrProvinceCode_A', max: 2 },
        { k: 'prodZip',     label: 'ZIP',              type: T, pdf: 'Producer_MailingAddress_PostalCode_A' },
        { k: 'prodContact', label: 'Contact name',     type: T, pdf: 'Producer_ContactPerson_FullName_A' },
        { k: 'prodPhone',   label: 'Phone (A/C, No, Ext)', type: T, pdf: 'Producer_ContactPerson_PhoneNumber_A' },
        { k: 'prodFax',     label: 'Fax (A/C, No)',    type: T, pdf: 'Producer_FaxNumber_A' },
        { k: 'prodEmail',   label: 'E-mail address',   type: T, pdf: 'Producer_ContactPerson_EmailAddress_A', wide: true }
    ]};

    // ── Insured ──────────────────────────────────────────────
    var INSURED = { id: 'insured', title: 'Insured', cols: 2, fields: [
        { k: 'insName',  label: 'Named insured',   type: T, pdf: 'NamedInsured_FullName_A', wide: true },
        { k: 'insAddr1', label: 'Address line 1',  type: T, pdf: 'NamedInsured_MailingAddress_LineOne_A', wide: true },
        { k: 'insAddr2', label: 'Address line 2',  type: T, pdf: 'NamedInsured_MailingAddress_LineTwo_A', wide: true },
        { k: 'insCity',  label: 'City',            type: T, pdf: 'NamedInsured_MailingAddress_CityName_A' },
        { k: 'insState', label: 'State',           type: T, pdf: 'NamedInsured_MailingAddress_StateOrProvinceCode_A', max: 2 },
        { k: 'insZip',   label: 'ZIP',             type: T, pdf: 'NamedInsured_MailingAddress_PostalCode_A' }
    ]};

    // ── Insurers affording coverage (A–F) ────────────────────
    var INSURER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
    var INSURERS = { id: 'insurers', title: 'Insurer(s) affording coverage', cols: 2, fields: [] };
    INSURER_LETTERS.forEach(function (L) {
        INSURERS.fields.push({ k: 'insurer' + L + 'Name', label: 'Insurer ' + L, type: T, pdf: 'Insurer_FullName_' + L });
        INSURERS.fields.push({ k: 'insurer' + L + 'Naic', label: 'NAIC # ' + L, type: T, pdf: 'Insurer_NAICCode_' + L });
    });

    // ── Certificate identity ─────────────────────────────────
    var HEADER = { id: 'header', title: 'Certificate', cols: 3, fields: [
        { k: 'certDate', label: 'Date (MM/DD/YYYY)',  type: D, pdf: 'Form_CompletionDate_A', mdy: true },
        { k: 'certNo',   label: 'Certificate number', type: T, pdf: 'CertificateOfInsurance_CertificateNumberIdentifier_A' },
        { k: 'revNo',    label: 'Revision number',    type: T, pdf: 'CertificateOfInsurance_RevisionNumberIdentifier_A' }
    ]};

    // ── Coverage rows ────────────────────────────────────────
    // Each row is one band of the COVERAGES table. `lob` lists the
    // lines of business that map onto this row, which is what lets a
    // declaration page be matched to the right band.
    var GL = {
        id: 'gl', title: 'Commercial General Liability', lob: [
            'general liability', 'commercial general liability', 'gl', 'bop',
            'business owner', 'liability', 'pollution liability', 'professional liability'
        ],
        checks: [
            { k: 'glOn',          label: 'Commercial General Liability', pdf: 'GeneralLiability_CoverageIndicator_A' },
            { k: 'glClaimsMade',  label: 'Claims-made',                  pdf: 'GeneralLiability_ClaimsMadeIndicator_A' },
            { k: 'glOccur',       label: 'Occur',                        pdf: 'GeneralLiability_OccurrenceIndicator_A' },
            { k: 'glAggPolicy',   label: "Gen'l aggregate per: Policy",  pdf: 'GeneralLiability_GeneralAggregate_LimitAppliesPerPolicyIndicator_A' },
            { k: 'glAggProject',  label: "Gen'l aggregate per: Project", pdf: 'GeneralLiability_GeneralAggregate_LimitAppliesPerProjectIndicator_A' },
            { k: 'glAggLoc',      label: "Gen'l aggregate per: Loc",     pdf: 'GeneralLiability_GeneralAggregate_LimitAppliesPerLocationIndicator_A' },
            { k: 'glAggOther',    label: "Gen'l aggregate per: Other",   pdf: 'GeneralLiability_GeneralAggregate_LimitAppliesToOtherIndicator_A' },
            { k: 'glOtherCovOn',  label: 'Other coverage 1',             pdf: 'GeneralLiability_OtherCoverageIndicator_A' },
            { k: 'glOtherCov2On', label: 'Other coverage 2',             pdf: 'GeneralLiability_OtherCoverageIndicator_B' }
        ],
        fields: [
            { k: 'glInsurer', label: 'Insurer letter',  type: T, pdf: 'GeneralLiability_InsurerLetterCode_A', max: 1 },
            { k: 'glAddl',    label: 'Addl insd (Y/N)', type: YN, pdf: 'CertificateOfInsurance_GeneralLiability_AdditionalInsuredCode_A', max: 1 },
            { k: 'glSubr',    label: 'Subr wvd (Y/N)',  type: YN, pdf: 'Policy_GeneralLiability_SubrogationWaivedCode_A', max: 1 },
            { k: 'glPolicyNo', label: 'Policy number',  type: T, pdf: 'Policy_GeneralLiability_PolicyNumberIdentifier_A', wide: true },
            { k: 'glEff',     label: 'Policy eff',      type: D, pdf: 'Policy_GeneralLiability_EffectiveDate_A', mdy: true },
            { k: 'glExp',     label: 'Policy exp',      type: D, pdf: 'Policy_GeneralLiability_ExpirationDate_A', mdy: true },
            { k: 'glAggOtherText', label: "Aggregate applies to (other)", type: T, pdf: 'GeneralLiability_GeneralAggregate_LimitAppliesToCode_A' },
            { k: 'glOtherCovText',  label: 'Other coverage 1 description', type: T, pdf: 'GeneralLiability_OtherCoverageDescription_A' },
            { k: 'glOtherCov2Text', label: 'Other coverage 2 description', type: T, pdf: 'GeneralLiability_OtherCoverageDescription_B' }
        ],
        limits: [
            { k: 'glEachOcc',    label: 'Each occurrence',               pdf: 'GeneralLiability_EachOccurrence_LimitAmount_A' },
            { k: 'glRented',     label: 'Damage to rented premises',     pdf: 'GeneralLiability_FireDamageRentedPremises_EachOccurrenceLimitAmount_A' },
            { k: 'glMedExp',     label: 'Med exp (any one person)',      pdf: 'GeneralLiability_MedicalExpense_EachPersonLimitAmount_A' },
            { k: 'glPersAdv',    label: 'Personal & adv injury',         pdf: 'GeneralLiability_PersonalAndAdvertisingInjury_LimitAmount_A' },
            { k: 'glGenAgg',     label: 'General aggregate',             pdf: 'GeneralLiability_GeneralAggregate_LimitAmount_A' },
            { k: 'glProdAgg',    label: 'Products - comp/op agg',        pdf: 'GeneralLiability_ProductsAndCompletedOperations_AggregateLimitAmount_A' },
            { k: 'glOtherLimit', label: 'Other',                         pdf: 'GeneralLiability_OtherCoverageLimitAmount_A',
              descK: 'glOtherLimitText', descPdf: 'GeneralLiability_OtherCoverageLimitDescription_A' }
        ]
    };

    var AUTO = {
        id: 'auto', title: 'Automobile Liability', lob: [
            'commercial auto', 'automobile liability', 'auto liability', 'trucking',
            'non-trucking liability', 'garage keepers', 'personal auto'
        ],
        checks: [
            { k: 'auAny',       label: 'Any auto',           pdf: 'Vehicle_AnyAutoIndicator_A' },
            { k: 'auOwned',     label: 'Owned autos only',   pdf: 'Vehicle_AllOwnedAutosIndicator_A' },
            { k: 'auScheduled', label: 'Scheduled autos',    pdf: 'Vehicle_ScheduledAutosIndicator_A' },
            { k: 'auHired',     label: 'Hired autos only',   pdf: 'Vehicle_HiredAutosIndicator_A' },
            { k: 'auNonOwned',  label: 'Non-owned autos only', pdf: 'Vehicle_NonOwnedAutosIndicator_A' },
            { k: 'auOther1On',  label: 'Other 1',            pdf: 'Vehicle_OtherCoveredAutoIndicator_A' },
            { k: 'auOther2On',  label: 'Other 2',            pdf: 'Vehicle_OtherCoveredAutoIndicator_B' }
        ],
        fields: [
            { k: 'auInsurer',  label: 'Insurer letter',  type: T, pdf: 'Vehicle_InsurerLetterCode_A', max: 1 },
            { k: 'auAddl',     label: 'Addl insd (Y/N)', type: YN, pdf: 'CertificateOfInsurance_AutomobileLiability_AdditionalInsuredCode_A', max: 1 },
            { k: 'auSubr',     label: 'Subr wvd (Y/N)',  type: YN, pdf: 'Policy_AutomobileLiability_SubrogationWaivedCode_A', max: 1 },
            { k: 'auPolicyNo', label: 'Policy number',   type: T, pdf: 'Policy_AutomobileLiability_PolicyNumberIdentifier_A', wide: true },
            { k: 'auEff',      label: 'Policy eff',      type: D, pdf: 'Policy_AutomobileLiability_EffectiveDate_A', mdy: true },
            { k: 'auExp',      label: 'Policy exp',      type: D, pdf: 'Policy_AutomobileLiability_ExpirationDate_A', mdy: true },
            { k: 'auOther1Text', label: 'Other 1 description', type: T, pdf: 'Vehicle_OtherCoveredAutoDescription_A' },
            { k: 'auOther2Text', label: 'Other 2 description', type: T, pdf: 'Vehicle_OtherCoveredAutoDescription_B' }
        ],
        limits: [
            { k: 'auCsl',        label: 'Combined single limit (ea accident)', pdf: 'Vehicle_CombinedSingleLimit_EachAccidentAmount_A' },
            { k: 'auBiPerson',   label: 'Bodily injury (per person)',          pdf: 'Vehicle_BodilyInjury_PerPersonLimitAmount_A' },
            { k: 'auBiAccident', label: 'Bodily injury (per accident)',        pdf: 'Vehicle_BodilyInjury_PerAccidentLimitAmount_A' },
            { k: 'auPd',         label: 'Property damage (per accident)',      pdf: 'Vehicle_PropertyDamage_PerAccidentLimitAmount_A' },
            { k: 'auOtherLimit', label: 'Other',                               pdf: 'Vehicle_OtherCoverage_LimitAmount_A',
              descK: 'auOtherLimitText', descPdf: 'Vehicle_OtherCoverage_CoverageDescription_A' }
        ]
    };

    var UMB = {
        id: 'umb', title: 'Umbrella / Excess Liability', lob: ['umbrella', 'excess liability', 'excess'],
        checks: [
            { k: 'umUmbrella',   label: 'Umbrella liab',  pdf: 'Policy_PolicyType_UmbrellaIndicator_A' },
            { k: 'umExcess',     label: 'Excess liab',    pdf: 'Policy_PolicyType_ExcessIndicator_A' },
            { k: 'umOccur',      label: 'Occur',          pdf: 'ExcessUmbrella_OccurrenceIndicator_A' },
            { k: 'umClaimsMade', label: 'Claims-made',    pdf: 'ExcessUmbrella_ClaimsMadeIndicator_A' },
            { k: 'umDed',        label: 'Ded',            pdf: 'ExcessUmbrella_DeductibleIndicator_A' },
            { k: 'umRetention',  label: 'Retention',      pdf: 'ExcessUmbrella_RetentionIndicator_A' }
        ],
        fields: [
            { k: 'umInsurer',  label: 'Insurer letter',  type: T, pdf: 'ExcessUmbrella_InsurerLetterCode_A', max: 1 },
            { k: 'umAddl',     label: 'Addl insd (Y/N)', type: YN, pdf: 'CertificateOfInsurance_ExcessLiability_AdditionalInsuredCode_A', max: 1 },
            { k: 'umSubr',     label: 'Subr wvd (Y/N)',  type: YN, pdf: 'Policy_ExcessLiability_SubrogationWaivedCode_A', max: 1 },
            { k: 'umPolicyNo', label: 'Policy number',   type: T, pdf: 'Policy_ExcessLiability_PolicyNumberIdentifier_A', wide: true },
            { k: 'umEff',      label: 'Policy eff',      type: D, pdf: 'Policy_ExcessLiability_EffectiveDate_A', mdy: true },
            { k: 'umExp',      label: 'Policy exp',      type: D, pdf: 'Policy_ExcessLiability_ExpirationDate_A', mdy: true },
            { k: 'umDedAmount', label: 'Ded / retention amount', type: T, pdf: 'ExcessUmbrella_Umbrella_DeductibleOrRetentionAmount_A', money: true }
        ],
        limits: [
            { k: 'umEachOcc',    label: 'Each occurrence', pdf: 'ExcessUmbrella_Umbrella_EachOccurrenceAmount_A' },
            { k: 'umAgg',        label: 'Aggregate',       pdf: 'ExcessUmbrella_Umbrella_AggregateAmount_A' },
            { k: 'umOtherLimit', label: 'Other',           pdf: 'ExcessUmbrella_OtherCoverageLimitAmount_A',
              descK: 'umOtherLimitText', descPdf: 'ExcessUmbrella_OtherCoverageDescription_A' }
        ]
    };

    var WC = {
        id: 'wc', title: "Workers Compensation and Employers' Liability",
        lob: ['workers comp', 'workers compensation', 'work comp', 'wc'],
        checks: [
            { k: 'wcPerStatute', label: 'Per statute', pdf: 'WorkersCompensationEmployersLiability_WorkersCompensationStatutoryLimitIndicator_A' },
            { k: 'wcOther',      label: 'Other',       pdf: 'WorkersCompensationEmployersLiability_OtherCoverageIndicator_A' }
        ],
        fields: [
            { k: 'wcInsurer',  label: 'Insurer letter', type: T, pdf: 'WorkersCompensationEmployersLiability_InsurerLetterCode_A', max: 1 },
            { k: 'wcExcluded', label: 'Any proprietor/partner/exec officer excluded? (Y/N)', type: YN,
              pdf: 'WorkersCompensationEmployersLiability_AnyPersonsExcludedIndicator_A', max: 1 },
            { k: 'wcSubr',     label: 'Subr wvd (Y/N)', type: YN, pdf: 'Policy_WorkersCompensation_SubrogationWaivedCode_A', max: 1 },
            { k: 'wcPolicyNo', label: 'Policy number',  type: T, pdf: 'Policy_WorkersCompensationAndEmployersLiability_PolicyNumberIdentifier_A', wide: true },
            { k: 'wcEff',      label: 'Policy eff',     type: D, pdf: 'Policy_WorkersCompensationAndEmployersLiability_EffectiveDate_A', mdy: true },
            { k: 'wcExp',      label: 'Policy exp',     type: D, pdf: 'Policy_WorkersCompensationAndEmployersLiability_ExpirationDate_A', mdy: true },
            { k: 'wcOtherText', label: 'Other description', type: T, pdf: 'WorkersCompensationEmployersLiability_OtherCoverageDescription_A' }
        ],
        limits: [
            { k: 'wcEachAccident', label: 'E.L. each accident',        pdf: 'WorkersCompensationEmployersLiability_EmployersLiability_EachAccidentLimitAmount_A' },
            { k: 'wcDiseaseEmp',   label: 'E.L. disease - ea employee', pdf: 'WorkersCompensationEmployersLiability_EmployersLiability_DiseaseEachEmployeeLimitAmount_A' },
            { k: 'wcDiseasePol',   label: 'E.L. disease - policy limit', pdf: 'WorkersCompensationEmployersLiability_EmployersLiability_DiseasePolicyLimitAmount_A' }
        ]
    };

    // The three free-form rows at the bottom of the COVERAGES table.
    var OTHER = { id: 'other', title: 'Other policies', lob: [], checks: [], fields: [
        { k: 'otInsurer',  label: 'Insurer letter',  type: T, pdf: 'OtherPolicy_InsurerLetterCode_A', max: 1 },
        { k: 'otAddl',     label: 'Addl insd (Y/N)', type: YN, pdf: 'CertificateOfInsurance_OtherPolicy_AdditionalInsuredCode_A', max: 1 },
        { k: 'otSubr',     label: 'Subr wvd (Y/N)',  type: YN, pdf: 'OtherPolicy_SubrogationWaivedCode_A', max: 1 },
        { k: 'otPolicyNo', label: 'Policy number',   type: T, pdf: 'OtherPolicy_PolicyNumberIdentifier_A', wide: true },
        { k: 'otEff',      label: 'Policy eff',      type: D, pdf: 'OtherPolicy_PolicyEffectiveDate_A', mdy: true },
        { k: 'otExp',      label: 'Policy exp',      type: D, pdf: 'OtherPolicy_PolicyExpirationDate_A', mdy: true },
        { k: 'otType1',    label: 'Type of insurance 1', type: T, pdf: 'OtherPolicy_CoverageCode_A' },
        { k: 'otLimit1',   label: 'Limit 1',         type: T, pdf: 'OtherPolicy_CoverageLimitAmount_A', money: true },
        { k: 'otType2',    label: 'Type of insurance 2', type: T, pdf: 'OtherPolicy_CoverageCode_B' },
        { k: 'otLimit2',   label: 'Limit 2',         type: T, pdf: 'OtherPolicy_CoverageLimitAmount_B', money: true },
        { k: 'otType3',    label: 'Type of insurance 3', type: T, pdf: 'OtherPolicy_CoverageCode_C' },
        { k: 'otLimit3',   label: 'Limit 3',         type: T, pdf: 'OtherPolicy_CoverageLimitAmount_C', money: true },
        { k: 'otDesc',     label: 'Description',     type: T, pdf: 'OtherPolicy_OtherPolicyDescription_A', wide: true }
    ], limits: [] };

    // ── Description, holder, signature ───────────────────────
    var DESCRIPTION = { id: 'description', title: 'Description of operations / locations / vehicles', cols: 1, fields: [
        { k: 'description', label: 'Description (ACORD 101 may be attached if more space is needed)',
          type: M, pdf: 'CertificateOfLiabilityInsurance_ACORDForm_RemarkText_A', wide: true }
    ]};

    var HOLDER = { id: 'holder', title: 'Certificate holder', cols: 2, fields: [
        { k: 'holdName',  label: 'Holder name',    type: T, pdf: 'CertificateHolder_FullName_A', wide: true },
        { k: 'holdAddr1', label: 'Address line 1', type: T, pdf: 'CertificateHolder_MailingAddress_LineOne_A', wide: true },
        { k: 'holdAddr2', label: 'Address line 2', type: T, pdf: 'CertificateHolder_MailingAddress_LineTwo_A', wide: true },
        { k: 'holdCity',  label: 'City',           type: T, pdf: 'CertificateHolder_MailingAddress_CityName_A' },
        { k: 'holdState', label: 'State',          type: T, pdf: 'CertificateHolder_MailingAddress_StateOrProvinceCode_A', max: 2 },
        { k: 'holdZip',   label: 'ZIP',            type: T, pdf: 'CertificateHolder_MailingAddress_PostalCode_A' }
    ]};

    var SIGNATURE = { id: 'signature', title: 'Authorized representative', cols: 1, fields: [
        { k: 'authorizedRep', label: 'Authorized representative', type: T, pdf: 'Producer_AuthorizedRepresentative_Signature_A', wide: true }
    ]};

    var COVERAGE_ROWS = [GL, AUTO, UMB, WC, OTHER];
    var INFO_SECTIONS = [HEADER, PRODUCER, INSURED, INSURERS];
    var TAIL_SECTIONS = [DESCRIPTION, HOLDER, SIGNATURE];

    // Every field the map knows about, flattened — used by the filler
    // and by the "what did the AI leave blank?" check.
    function allFields() {
        var out = [];
        INFO_SECTIONS.concat(TAIL_SECTIONS).forEach(function (s) {
            s.fields.forEach(function (f) { out.push(f); });
        });
        COVERAGE_ROWS.forEach(function (r) {
            (r.fields || []).forEach(function (f) { out.push(f); });
            (r.limits || []).forEach(function (l) {
                out.push({ k: l.k, label: l.label, type: T, pdf: l.pdf, money: true });
                if (l.descK) out.push({ k: l.descK, label: l.label + ' (description)', type: T, pdf: l.descPdf });
            });
            (r.checks || []).forEach(function (c) { out.push({ k: c.k, label: c.label, type: C, pdf: c.pdf }); });
        });
        return out;
    }

    // Which coverage row does a line of business belong to? This is what
    // lets a declaration page be matched against the bands the
    // certificate actually shows. Returns null for a line the ACORD 25
    // has no band for (a homeowners policy, say) so the agent is never
    // asked to put it somewhere it does not belong.
    function rowForLineOfBusiness(lob) {
        var s = String(lob || '').trim().toLowerCase();
        if (!s) return null;
        for (var i = 0; i < COVERAGE_ROWS.length; i++) {
            var r = COVERAGE_ROWS[i];
            for (var j = 0; j < (r.lob || []).length; j++) {
                if (s === r.lob[j] || s.indexOf(r.lob[j]) !== -1) return r;
            }
        }
        return null;
    }

    window.ACORD25 = {
        PDF_URL: 'forms/acord25.pdf',
        EDITION: 'ACORD 25 (2025/12)',
        EDITION_FIELD: 'Form_EditionIdentifier_A',
        INSURER_LETTERS: INSURER_LETTERS,
        INFO_SECTIONS: INFO_SECTIONS,
        COVERAGE_ROWS: COVERAGE_ROWS,
        TAIL_SECTIONS: TAIL_SECTIONS,
        allFields: allFields,
        rowForLineOfBusiness: rowForLineOfBusiness
    };
})();
