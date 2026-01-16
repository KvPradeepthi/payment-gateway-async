/**
 * Payment Gateway SDK - Embeddable JavaScript Library
 * Version: 1.0.0
 * Description: Client-side SDK for integrating payment gateway in third-party websites
 */

(function(window) {
  'use strict';

  const PaymentGateway = function(config) {
    this.apiUrl = config.apiUrl || 'https://api.payment-gateway.local';
    this.merchantId = config.merchantId;
    this.publicKey = config.publicKey;
    this.timeout = config.timeout || 30000;
    this.onSuccess = config.onSuccess || function() {};
    this.onError = config.onError || function() {};
  };

  /**
   * Create a payment
   * @param {Object} paymentData - Payment information
   * @returns {Promise} Payment creation promise
   */
  PaymentGateway.prototype.createPayment = function(paymentData) {
    const self = this;
    
    return new Promise((resolve, reject) => {
      const idempotencyKey = this._generateUUID();
      
      const xhr = new XMLHttpRequest();
      xhr.timeout = this.timeout;
      
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          if (xhr.status === 201 || xhr.status === 200) {
            try {
              const response = JSON.parse(xhr.responseText);
              self.onSuccess(response);
              resolve(response);
            } catch (e) {
              reject(new Error('Invalid response format'));
            }
          } else {
            const error = new Error(`Payment creation failed: ${xhr.status}`);
            self.onError(error);
            reject(error);
          }
        }
      };
      
      xhr.onerror = function() {
        const error = new Error('Network error');
        self.onError(error);
        reject(error);
      };
      
      xhr.ontimeout = function() {
        const error = new Error('Request timeout');
        self.onError(error);
        reject(error);
      };
      
      xhr.open('POST', this.apiUrl + '/payments', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Idempotency-Key', idempotencyKey);
      xhr.send(JSON.stringify(paymentData));
    });
  };

  /**
   * Get payment status
   * @param {String} paymentId - Payment ID
   * @returns {Promise} Payment status promise
   */
  PaymentGateway.prototype.getPayment = function(paymentId) {
    const self = this;
    
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.timeout = this.timeout;
      
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          if (xhr.status === 200) {
            try {
              const response = JSON.parse(xhr.responseText);
              resolve(response);
            } catch (e) {
              reject(new Error('Invalid response format'));
            }
          } else {
            reject(new Error(`Failed to fetch payment: ${xhr.status}`));
          }
        }
      };
      
      xhr.onerror = function() {
        reject(new Error('Network error'));
      };
      
      xhr.open('GET', this.apiUrl + '/payments/' + paymentId, true);
      xhr.send();
    });
  };

  /**
   * Create a refund
   * @param {String} paymentId - Payment ID
   * @param {Object} refundData - Refund details
   * @returns {Promise} Refund creation promise
   */
  PaymentGateway.prototype.refundPayment = function(paymentId, refundData) {
    const self = this;
    
    return new Promise((resolve, reject) => {
      const idempotencyKey = this._generateUUID();
      
      const xhr = new XMLHttpRequest();
      xhr.timeout = this.timeout;
      
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          if (xhr.status === 201 || xhr.status === 200) {
            try {
              const response = JSON.parse(xhr.responseText);
              resolve(response);
            } catch (e) {
              reject(new Error('Invalid response format'));
            }
          } else {
            reject(new Error(`Refund failed: ${xhr.status}`));
          }
        }
      };
      
      xhr.onerror = function() {
        reject(new Error('Network error'));
      };
      
      xhr.open('POST', this.apiUrl + '/payments/' + paymentId + '/refund', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Idempotency-Key', idempotencyKey);
      xhr.send(JSON.stringify(refundData));
    });
  };

  /**
   * Generate UUID v4
   * @private
   * @returns {String} UUID
   */
  PaymentGateway.prototype._generateUUID = function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  // Export to global scope
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PaymentGateway;
  } else {
    window.PaymentGateway = PaymentGateway;
  }

})(typeof window !== 'undefined' ? window : global);
