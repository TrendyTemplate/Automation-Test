/**
 * Admin GraphQL operations used by Delaywise (API version 2026-10).
 * Validated against the 2026-10 Admin schema with `npm run validate:graphql`.
 */

export const SHOP_INFO_QUERY = `#graphql
  query DelaywiseShopInfo {
    shop {
      name
      contactEmail
      myshopifyDomain
      billingAddress {
        countryCodeV2
      }
    }
    currentAppInstallation {
      activeSubscriptions {
        name
        status
        test
      }
    }
  }`;

export const SHIPPED_ORDERS_QUERY = `#graphql
  query DelaywiseShippedOrders($query: String!, $after: String) {
    orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        customerLocale
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        shippingAddress {
          countryCodeV2
        }
        fulfillments(first: 10) {
          id
          createdAt
          inTransitAt
          deliveredAt
          estimatedDeliveryAt
          displayStatus
          trackingInfo(first: 1) {
            company
            number
            url
          }
          events(first: 1, sortKey: HAPPENED_AT, reverse: true) {
            nodes {
              status
              happenedAt
            }
          }
        }
      }
    }
  }`;

/** Fetched only at send time; the email is never stored. */
export const ORDER_CONTACT_QUERY = `#graphql
  query DelaywiseOrderContact($id: ID!) {
    order(id: $id) {
      id
      email
    }
  }`;

export const CREATE_DISCOUNT_MUTATION = `#graphql
  mutation DelaywiseCreateSorryDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

export const ALL_OPERATIONS = {
  SHOP_INFO_QUERY,
  SHIPPED_ORDERS_QUERY,
  ORDER_CONTACT_QUERY,
  CREATE_DISCOUNT_MUTATION,
};
