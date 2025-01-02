import {
  createLinodeRequestFactory,
  linodeConfigFactory,
  LinodeConfigInterfaceFactory,
  linodeFactory,
  VLANFactory,
  volumeFactory,
} from '@src/factories';
import {
  interceptCloneLinode,
  mockGetLinodeDetails,
  mockGetLinodes,
  mockGetLinodeType,
  mockGetLinodeTypes,
  mockCreateLinode,
  mockCloneLinode,
  mockGetLinodeVolumes,
} from 'support/intercepts/linodes';
import { linodeCreatePage } from 'support/ui/pages';
import { mockGetVLANs } from 'support/intercepts/vlans';
import { ui } from 'support/ui';
import {
  dcPricingMockLinodeTypes,
  dcPricingRegionDifferenceNotice,
  dcPricingDocsLabel,
  dcPricingDocsUrl,
} from 'support/constants/dc-specific-pricing';
import { chooseRegion, getRegionById } from 'support/util/regions';
import {
  randomLabel,
  randomNumber,
  randomString,
  randomIp,
} from 'support/util/random';
import { authenticate } from 'support/api/authentication';
import { cleanUp } from 'support/util/cleanup';
import { createTestLinode } from 'support/util/linodes';
import type { Linode } from '@linode/api-v4';
import { mockGetLinodeConfigs } from 'support/intercepts/configs';

/**
 * Returns the Cloud Manager URL to clone a given Linode.
 *
 * @param linode - Linode for which to retrieve clone URL.
 *
 * @returns Cloud Manager Clone URL for Linode.
 */
const getLinodeCloneUrl = (linode: Linode): string => {
  const regionQuery = `&regionID=${linode.region}`;
  const typeQuery = linode.type ? `&typeID=${linode.type}` : '';
  return `/linodes/create?linodeID=${linode.id}${regionQuery}&type=Clone+Linode${typeQuery}`;
};

/* Timeout after 4 minutes while waiting for clone. */
const CLONE_TIMEOUT = 240_000;

authenticate();
describe('clone linode', () => {
  before(() => {
    cleanUp('linodes');
  });

  /*
   * - Confirms Linode Clone flow via the Linode details page.
   * - Confirms that Linode can be cloned successfully.
   */
  it('can clone a Linode from Linode details page', () => {
    cy.tag('method:e2e', 'purpose:dcTesting');
    const linodeRegion = chooseRegion({ capabilities: ['Vlans'] });
    const linodePayload = createLinodeRequestFactory.build({
      label: randomLabel(),
      region: linodeRegion.id,
      booted: false,
      type: 'g6-nanode-1',
    });

    const newLinodeLabel = `${linodePayload.label}-clone`;

    // Use `vlan_no_internet` security method.
    // This works around an issue where the Linode API responds with a 400
    // when attempting to interact with it shortly after booting up when the
    // Linode is attached to a Cloud Firewall.
    cy.defer(() =>
      createTestLinode(linodePayload, { securityMethod: 'vlan_no_internet' })
    ).then((linode: Linode) => {
      interceptCloneLinode(linode.id).as('cloneLinode');
      cy.visitWithLogin(`/linodes/${linode.id}`);

      // Wait for Linode to boot, then initiate clone flow.
      cy.findByText('OFFLINE').should('be.visible');

      ui.actionMenu
        .findByTitle(`Action menu for Linode ${linode.label}`)
        .should('be.visible')
        .click();

      ui.actionMenuItem.findByTitle('Clone').should('be.visible').click();
      cy.url().should('endWith', getLinodeCloneUrl(linode));

      // Select clone region and Linode type.
      ui.regionSelect.find().click();
      ui.regionSelect.findItemByRegionId(linodeRegion.id).click();

      cy.findByText('Shared CPU').should('be.visible').click();

      cy.get('[id="g6-standard-1"]')
        .closest('[data-qa-radio]')
        .should('be.visible')
        .click();

      // Confirm summary displays expected information and begin clone.
      cy.findByText(`Summary ${newLinodeLabel}`).should('be.visible');

      ui.button
        .findByTitle('Create Linode')
        .should('be.visible')
        .should('be.enabled')
        .click();

      cy.wait('@cloneLinode').then((xhr) => {
        const newLinodeId = xhr.response?.body?.id;
        assert.equal(xhr.response?.statusCode, 200);
        cy.url().should('endWith', `linodes/${newLinodeId}`);
      });

      ui.toast.assertMessage(`Your Linode ${newLinodeLabel} is being created.`);
      ui.toast.assertMessage(
        `Linode ${linode.label} has been cloned to ${newLinodeLabel}.`,
        { timeout: CLONE_TIMEOUT }
      );
    });
  });

  /*
   * - Confirms Linode Clone flow can handle null type gracefully.
   * - Confirms that Linode (mock) can be cloned successfully.
   */
  it('can clone a Linode with null type', () => {
    const mockLinodeRegion = chooseRegion({
      capabilities: ['Linodes', 'Vlans'],
    });
    const mockLinode = linodeFactory.build({
      id: randomNumber(),
      label: randomLabel(),
      region: mockLinodeRegion.id,
      status: 'offline',
      type: null,
    });
    const mockVolume = volumeFactory.build();
    const mockPublicConfigInterface = LinodeConfigInterfaceFactory.build({
      ipam_address: null,
      purpose: 'public',
    });
    const mockConfig = linodeConfigFactory.build({
      id: randomNumber(),
      interfaces: [
        // The order of this array is significant. Index 0 (eth0) should be public.
        mockPublicConfigInterface,
      ],
    });
    const mockVlan = VLANFactory.build({
      id: randomNumber(),
      label: randomLabel(),
      region: mockLinodeRegion.id,
      cidr_block: `${randomIp()}/24`,
      linodes: [],
    });

    const linodeNullTypePayload = createLinodeRequestFactory.build({
      label: mockLinode.label,
      region: mockLinodeRegion.id,
      booted: false,
    });
    const newLinodeLabel = `${linodeNullTypePayload.label}-clone`;
    const clonedLinode = {
      ...mockLinode,
      id: mockLinode.id + 1,
      label: newLinodeLabel,
    };

    mockGetVLANs([mockVlan]);
    mockCreateLinode(mockLinode).as('createLinode');
    mockGetLinodeDetails(mockLinode.id, mockLinode).as('getLinode');
    mockGetLinodeVolumes(clonedLinode.id, [mockVolume]).as('getLinodeVolumes');
    mockGetLinodeConfigs(clonedLinode.id, [mockConfig]).as('getLinodeConfigs');
    cy.visitWithLogin('/linodes/create');

    // Fill out necessary Linode create fields.
    linodeCreatePage.selectRegionById(mockLinodeRegion.id);
    linodeCreatePage.selectImage('Debian 11');
    linodeCreatePage.setLabel(mockLinode.label);
    linodeCreatePage.selectPlan('Shared CPU', 'Nanode 1 GB');
    linodeCreatePage.setRootPassword(randomString(32));

    // Open VLAN accordion and select existing VLAN.
    ui.accordionHeading.findByTitle('VLAN').click();
    ui.accordion
      .findByTitle('VLAN')
      .scrollIntoView()
      .should('be.visible')
      .within(() => {
        cy.findByLabelText('VLAN').should('be.enabled').type(mockVlan.label);

        ui.autocompletePopper
          .findByTitle(mockVlan.label)
          .should('be.visible')
          .click();

        cy.findByLabelText(/IPAM Address/)
          .should('be.enabled')
          .type(mockVlan.cidr_block);
      });

    // Confirm that VLAN attachment is listed in summary, then create Linode.
    cy.get('[data-qa-linode-create-summary]')
      .scrollIntoView()
      .within(() => {
        cy.findByText('VLAN Attached').should('be.visible');
      });

    ui.button
      .findByTitle('Create Linode')
      .should('be.visible')
      .should('be.enabled')
      .click();

    // Confirm outgoing API request payload has expected data.
    cy.wait('@createLinode').then((xhr) => {
      const requestPayload = xhr.request.body;
      const expectedPublicInterface = requestPayload['interfaces'][0];
      const expectedVlanInterface = requestPayload['interfaces'][1];

      // Confirm that first interface is for public internet.
      expect(expectedPublicInterface['purpose']).to.equal('public');

      // Confirm that second interface is our chosen VLAN.
      expect(expectedVlanInterface['purpose']).to.equal('vlan');
      expect(expectedVlanInterface['label']).to.equal(mockVlan.label);
      expect(expectedVlanInterface['ipam_address']).to.equal(
        mockVlan.cidr_block
      );
    });

    cy.url().should('endWith', `/linodes/${mockLinode.id}`);
    // Confirm toast notification should appear on Linode create.
    ui.toast.assertMessage(`Your Linode ${mockLinode.label} is being created.`);

    mockCloneLinode(mockLinode.id, clonedLinode).as('cloneLinode');
    cy.visitWithLogin(`/linodes/${mockLinode.id}`);

    // Wait for Linode to boot, then initiate clone flow.
    cy.findByText('OFFLINE').should('be.visible');

    ui.actionMenu
      .findByTitle(`Action menu for Linode ${mockLinode.label}`)
      .should('be.visible')
      .click();

    ui.actionMenuItem.findByTitle('Clone').should('be.visible').click();
    const url = getLinodeCloneUrl(mockLinode);
    console.log(`linode clone url: ${url}`);
    cy.url().should('endWith', getLinodeCloneUrl(mockLinode));

    // Select clone region and Linode type.
    ui.regionSelect.find().click();
    ui.regionSelect.findItemByRegionId(mockLinodeRegion.id).click();

    cy.findByText('Shared CPU').should('be.visible').click();

    cy.get('[id="g6-standard-1"]')
      .closest('[data-qa-radio]')
      .should('be.visible')
      .click();

    // Confirm summary displays expected information and begin clone.
    cy.findByText(`Summary ${newLinodeLabel}`).should('be.visible');

    ui.button
      .findByTitle('Create Linode')
      .should('be.visible')
      .should('be.enabled')
      .click();

    cy.wait('@cloneLinode').then((xhr) => {
      const newLinodeId = xhr.response?.body?.id;
      assert.equal(xhr.response?.statusCode, 200);
      console.log(`cy.url(): ${cy.url()}`);
      cy.url().should('endWith', `linodes/${newLinodeId}`);
    });

    cy.wait(['@getLinodeVolumes', '@getLinodeConfigs']);
    ui.toast.assertMessage(`Your Linode ${newLinodeLabel} is being created.`);
  });

  /*
   * - Confirms DC-specific pricing UI flow works as expected during Linode clone.
   * - Confirms that pricing docs link is shown in "Region" section.
   * - Confirms that notice is shown when selecting a region with a different price structure.
   */
  it('shows DC-specific pricing information during clone flow', () => {
    const initialRegion = getRegionById('us-west');
    const newRegion = getRegionById('us-east');

    const mockLinode = linodeFactory.build({
      region: initialRegion.id,
      type: dcPricingMockLinodeTypes[0].id,
    });

    mockGetLinodes([mockLinode]).as('getLinodes');
    mockGetLinodeDetails(mockLinode.id, mockLinode).as('getLinode');

    // Mock requests to get all Linode types, and to get individual types.
    mockGetLinodeType(dcPricingMockLinodeTypes[0]);
    mockGetLinodeType(dcPricingMockLinodeTypes[1]);
    mockGetLinodeTypes(dcPricingMockLinodeTypes).as('getLinodeTypes');

    cy.visitWithLogin(getLinodeCloneUrl(mockLinode));
    cy.wait(['@getLinode', '@getLinodes', '@getLinodeTypes']);

    // Confirm there is a docs link to the pricing page.
    cy.findByText(dcPricingDocsLabel)
      .should('be.visible')
      .should('have.attr', 'href', dcPricingDocsUrl);

    // Confirm that DC-specific pricing difference notice is not yet shown.
    cy.findByText(dcPricingRegionDifferenceNotice, { exact: false }).should(
      'not.exist'
    );

    ui.regionSelect
      .findBySelectedItem(`${initialRegion.label} (${initialRegion.id})`)
      .click()
      .type(`${newRegion.label}{enter}`);

    cy.findByText(dcPricingRegionDifferenceNotice, { exact: false }).should(
      'be.visible'
    );
  });
});
