/**
 * AutoCare - shared application data and constants.
 * Loaded before script.js (both are defer-ed) so the dashboard IIFE can
 * read window.AutoCareData without any module bundler.
 */
"use strict";

window.AutoCareData = Object.freeze({

  /** Categories supported by the exported ML service-cost model. */
  PREDICTION_CATEGORIES: [
    "Regular service",
    "Oil change",
    "Brake service",
    "Tyre replacement",
  ],

  /** All categories shown in the service-log form (superset of PREDICTION_CATEGORIES). */
  ALL_SERVICE_CATEGORIES: [
    "Regular service",
    "Oil change",
    "Brake service",
    "Tyre replacement",
    "Battery",
    "Repair",
    "Other",
  ],

  /** Chart / breakdown colours - order matches ALL_SERVICE_CATEGORIES. */
  CATEGORY_COLORS: [
    "#20a997",
    "#5a79d6",
    "#efaa55",
    "#a187d4",
    "#e47a78",
    "#4c9cc1",
    "#96a6b1",
  ],

  /** Regions the service-cost model was trained on. */
  SUPPORTED_REGIONS: ["Chennai", "Mumbai"],

  /** Fuel types the service-cost model supports. */
  SUPPORTED_FUELS: ["Petrol", "Diesel"],

  /** Vehicle types accepted by the repair/towing dataset model. */
  VEHICLE_TYPES_REPAIR: ["Car", "SUV", "Truck", "Van", "Motorcycle", "Bus"],

  /** Urgency levels observed in the repair/towing CSV. */
  URGENCY_LEVELS: ["Scheduled", "Standard", "Emergency"],

  /** Customer types in the repair/towing dataset. */
  CUSTOMER_TYPES: ["Individual", "Business", "Fleet"],

  /**
   * Maintenance categories the repair/towing classifier (maintenance_category_model.joblib)
   * can predict.
   */
  REPAIR_CATEGORIES: [
    "Oil Change",
    "Engine Repair",
    "Battery Replacement",
    "Tire Replacement",
    "Towing",
    "Transmission Repair",
    "Brake Service",
  ],
});
