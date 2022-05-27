/* @flow */
import { ZalgoPromise } from '@krakenjs/zalgo-promise/src';
import { FUNDING } from '@paypal/sdk-constants/src';
import { memoize, querySelectorAll, debounce, noop } from '@krakenjs/belter/src';
import { getParent, getTop } from '@krakenjs/cross-domain-utils/src';

import { DATA_ATTRIBUTES, TARGET_ELEMENT, CONTEXT } from '../constants';
import { unresolvedPromise, promiseNoop } from '../lib';
import { getConfirmOrder } from '../props/confirmOrder';

import type { PaymentFlow, PaymentFlowInstance, IsEligibleOptions, InitOptions } from './types';
import { checkout } from './checkout';

function setupPaymentField() {
    // pass
}
const canRenderTop = false;

function getRenderWindow() : Object {
    const top = getTop(window);
    if (canRenderTop && top) {
        return top;
    } else if (getParent()) {
        return getParent();
    } else {
        return window;
    }
}
let paymentFieldsOpen = false;

function isPaymentFieldsEligible({ props, serviceData, event } : IsEligibleOptions) : boolean {
    return true;
}
function isPaymentFieldsPaymentEligible({ event }) : boolean {
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
        el.style.display = '';
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

const slideDownButtons = () => {
    const buttonsContainer = document.querySelector('#buttons-container');

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
    let instance;
    let approved = false;
    let forceClosed = false;
    const onClose = () => {
        paymentFieldsOpen = false;
    };
    const restart = memoize(() : ZalgoPromise<void> =>
        checkout.init({ props, components, payment: { ...payment, isClick: false }, serviceData, config, restart })
            .start().finally(unresolvedPromise));
    let buyerAccessToken;
    const { render, close: closeCardForm } = PaymentFields({
        fundingSource,
        fieldsSessionID,
        onContinue:   async (data) => {
            const orderID = await createOrder();
            return getConfirmOrder({
                orderID, payload: data, partnerAttributionID
            }, {
                facilitatorAccessToken: serviceData.facilitatorAccessToken
            }).then(() => {
                instance = Checkout({
                    ...props,
                    onClose: () => {
                        if (!forceClosed && !approved) {
                            return close().then(() => {
                                return onCancel();
                            });
                        }
                    },
                    onApprove: ({ payerID, paymentID, billingToken }) => {
                        approved = true;
                        // eslint-disable-next-line no-use-before-define
                        return close().then(() => {
                            return onApprove({ payerID, paymentID, billingToken, buyerAccessToken }, { restart }).catch(noop);
                        });
                    },
                    sdkMeta,
                    branded: false,
                    standaloneFundingSource: fundingSource,
                    inlinexo: false,
                    onCancel: () => {
                        // eslint-disable-next-line no-use-before-define
                        return close().then(() => {
                            return onCancel();
                        });
                    },
                    onAuth: ({ accessToken }) => {
                        const access_token = accessToken ? accessToken : buyerAccessToken;
                        return onAuth({ accessToken: access_token }).then(token => {
                            buyerAccessToken = token;
                        });
                    },
                    restart,
                });
                instance.renderTo(getRenderWindow(), TARGET_ELEMENT.BODY, CONTEXT.POPUP);
            });
        },
        onFieldsClose: () => {
            return closeCardForm().then(() => {
                paymentFieldsOpen = false;
                slideDownButtons();
            })
        },
        onError,
        onClose,
        showActionButtons: true,
        sdkMeta,
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
        return closeCardForm().then(() => {
            forceClosed = true;
            paymentFieldsOpen = false;
            instance.close();
            return slideDownButtons();
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
