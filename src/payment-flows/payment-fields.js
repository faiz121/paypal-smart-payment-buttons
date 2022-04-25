/* @flow */
import { ZalgoPromise } from '@krakenjs/zalgo-promise/src';
import { FUNDING } from '@paypal/sdk-constants/src';
import { memoize, querySelectorAll, debounce, noop } from '@krakenjs/belter/src';
import { getParent } from '@krakenjs/cross-domain-utils/src';

import { DATA_ATTRIBUTES, TARGET_ELEMENT } from '../constants';
import { unresolvedPromise, promiseNoop } from '../lib';
import { getConfirmOrder } from '../props/confirmOrder';

import type { PaymentFlow, PaymentFlowInstance, IsEligibleOptions, IsPaymentEligibleOptions, InitOptions } from './types';
import { checkout } from './checkout';

function setupPaymentField() {
    // pass
}
let paymentFieldsOpen = false;
// function isPaymentFieldsEligible({ props, serviceData } : IsEligibleOptions) : boolean {
//     const { vault, onShippingChange, inline } = props;
//     const { eligibility } = serviceData;
//
//     if (inline) {
//         return false;
//     }
//
//     if (vault) {
//         return false;
//     }
//
//     if (onShippingChange) {
//         return false;
//     }
//
//     return eligibility.paymentFields;
// }
// function isPaymentFieldsPaymentEligible({ payment } : IsPaymentEligibleOptions) : boolean {
//     const { win, fundingSource } = payment || {};
//
//     if (win) {
//         return false;
//     }
//
//     if (fundingSource && fundingSource !== FUNDING.EPS) {
//         return false;
//     }
//
//     return true;
// }
function isPaymentFieldsEligible({ props, serviceData } : IsEligibleOptions) : boolean {
    console.log('props ---- ', props);
    console.log('serviceData ---- ', serviceData);
    return true;
}
function isPaymentFieldsPaymentEligible() : boolean {
    return true;
}
function highlightCard(fundingSource : ?$Values<typeof FUNDING>) {
    if (!fundingSource) {
        return;
    }
    querySelectorAll(`[${ DATA_ATTRIBUTES.FUNDING_SOURCE }]`).forEach(el => {
        if (el.getAttribute(DATA_ATTRIBUTES.FUNDING_SOURCE) === fundingSource.toLowerCase()) {
            el.style.opacity = '1';
        } else {
            el.style.display = 'none';
            el.parentElement.style.display = 'none';
            el.style.opacity = '0.1';
        }
    });
}

function unhighlightCards() {
    querySelectorAll(`[${ DATA_ATTRIBUTES.FUNDING_SOURCE }]`).forEach(el => {
        el.style.opacity = '1';
        el.parentElement.style.display = '';
    });
}

const getElements = (fundingSource : ?$Values<typeof FUNDING>) : {| buttonsContainer : HTMLElement, epsButtonsContainer : HTMLElement, paymentFieldsContainer : HTMLElement |} => {
    const buttonsContainer = document.querySelector('#buttons-container');
    const epsButtonsContainer = document.querySelector(`[${ DATA_ATTRIBUTES.FUNDING_SOURCE }="${ fundingSource }"]`);
    const paymentFieldsContainer = document.querySelector('#payment-fields-container');

    if (!buttonsContainer || !epsButtonsContainer || !paymentFieldsContainer) {
        throw new Error(`Did not find payment fields elements`);
    }

    return { buttonsContainer, epsButtonsContainer, paymentFieldsContainer };
};

let resizeListener;

const slideUpButtons = (fundingSource : ?$Values<typeof FUNDING>) => {
    const { buttonsContainer, epsButtonsContainer, paymentFieldsContainer } = getElements(fundingSource);

    if (!buttonsContainer || !epsButtonsContainer || !paymentFieldsContainer) {
        throw new Error(`Required elements not found`);
    }

    paymentFieldsContainer.style.minHeight = '0px';
    paymentFieldsContainer.style.display = 'block';

    const recalculateMargin = () => {
        buttonsContainer.style.marginTop = `${ buttonsContainer.offsetTop - epsButtonsContainer.offsetTop }px`;
    };

    resizeListener = debounce(() => {
        buttonsContainer.style.transitionDuration = '0s';
        recalculateMargin();
    });
    window.addEventListener('resize', resizeListener);

    recalculateMargin();
};

const slideDownButtons = (fundingSource : ?$Values<typeof FUNDING>) => {
    const { buttonsContainer } = getElements(fundingSource);

    unhighlightCards();
    window.removeEventListener('resize', resizeListener);
    buttonsContainer.style.removeProperty('transition-duration');
    buttonsContainer.style.removeProperty('margin-top');
};
function initPaymentFields({ props, components, payment, serviceData, config } : InitOptions) : PaymentFlowInstance {
    const { createOrder, onApprove, onCancel,
        locale, commit, onError, sessionID, fieldsSessionID, partnerAttributionID, buttonSessionID, onAuth  } = props;
    const { PaymentFields, Checkout } = components;
    const { fundingSource } = payment;
    const { cspNonce } = config;
    const { buyerCountry, sdkMeta } = serviceData;
    if (paymentFieldsOpen) {
        // highlightCard(card);
        return {
            start: promiseNoop,
            close: promiseNoop
        };
    }
    const restart = memoize(() : ZalgoPromise<void> => {
        return close().finally(() => {
            return initPaymentFields({ props, components, serviceData, config, payment: { ...payment }, restart })
                .start().finally(unresolvedPromise);
        });
    });
    const onClose = () => {
        paymentFieldsOpen = false;
    };
    // const onCardTypeChange = ({ card: cardType }) => {
    //     highlightCard(cardType);
    // };
    let buyerAccessToken;
    const { render, close: closeCardForm } = PaymentFields({
        fundingSource,
        fieldsSessionID,
        createOrder,
        onContinue: async (data) => {
            console.log('data in spb payment-fields ----- ', data);
            const orderID = await createOrder();
            return getConfirmOrder({
                orderID, payload: data, partnerAttributionID
            }, {
                facilitatorAccessToken: serviceData.facilitatorAccessToken
            }).then((response) => {
                let checkout = Checkout({
                    ...props,
                    onClose: () => {
                        console.log('onClose was fired');
                    },
                    sdkMeta,
                    branded: false,
                    standaloneFundingSource: fundingSource,
                    inlinexo: false,
                    onCancel: () => {
                        console.log('pop up closed');
                    }
                });
                checkout.renderTo(getParent(), TARGET_ELEMENT.BODY);
            });
        },
        onApprove:     ({ payerID, paymentID, billingToken }) => {
            // eslint-disable-next-line no-use-before-define
            return close().then(() => {
                return onApprove({ payerID, paymentID, billingToken, buyerAccessToken }, { restart }).catch(noop);
            });
        },
        onAuth: ({ accessToken }) => {
            const access_token = accessToken ? accessToken : buyerAccessToken;
            return onAuth({ accessToken: access_token }).then(token => {
                buyerAccessToken = token;
            });
        },
        onCancel: () => {
            // eslint-disable-next-line no-use-before-define
            return close().then(() => {
                return onCancel();
            });
        },
        onError,
        onClose,
        sessionID,
        buttonSessionID,
        buyerCountry,
        locale,
        commit,
        cspNonce,
    });
    const start = () => {
        paymentFieldsOpen = true;
        const renderPromise = render('#payment-fields-container');
        slideUpButtons(fundingSource);
        highlightCard(fundingSource);
        return renderPromise;
    };
    const close = () => {
        slideDownButtons();
        return closeCardForm().then(() => {
            paymentFieldsOpen = false;
        });
    };
    return { start, close };
}
export const paymentFields : PaymentFlow = {
    name:              'payment_fields',
    setup:             setupPaymentField,
    isEligible:        isPaymentFieldsEligible,
    isPaymentEligible: isPaymentFieldsPaymentEligible,
    init:              initPaymentFields,
    inline:            true
};
