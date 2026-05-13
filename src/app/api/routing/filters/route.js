import { NextResponse } from "next/server";
import {
  getRoutingFilters,
  getRoutingFilterById,
  createRoutingFilter,
  updateRoutingFilter,
  deleteRoutingFilter
} from "@/lib/localDb.js";
import { checkAuth } from "@/lib/auth/middleware.js";
import { apiError } from "@/lib/apiErrors.js";

/**
 * GET /api/routing/filters
 * Get all routing filters (optionally only active ones)
 */
export async function GET(request) {
  try {
    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("activeOnly") === "true";

    const filters = await getRoutingFilters(activeOnly);
    return NextResponse.json({ filters });
  } catch (error) {
    console.error("Failed to get routing filters:", error);
    return apiError(request, 500, "Internal Server Error");
  }
}

/**
 * POST /api/routing/filters
 * Create a new routing filter
 */
export async function POST(request) {
  try {
    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }

    const data = await request.json();

    // Validate required fields
    if (!data.name || !data.filter_type || !data.operator || data.value === undefined) {
      return apiError(request, 400, "Missing required fields: name, filter_type, operator, value");
    }

    // Validate filter_type
    const validTypes = ["trust_score", "ip_address", "country", "cost", "latency"];
    if (!validTypes.includes(data.filter_type)) {
      return apiError(request, 400, `Invalid filter_type. Must be one of: ${validTypes.join(", ")}`);
    }

    // Validate operator
    const validOperators = ["gte", "lte", "eq", "in_range", "in_list", "not_in_list"];
    if (!validOperators.includes(data.operator)) {
      return apiError(request, 400, `Invalid operator. Must be one of: ${validOperators.join(", ")}`);
    }

    // Validate action
    if (data.action && !["allow", "block"].includes(data.action)) {
      return apiError(request, 400, "Invalid action. Must be 'allow' or 'block'");
    }

    const filter = await createRoutingFilter(data);
    return NextResponse.json(filter, { status: 201 });
  } catch (error) {
    console.error("Failed to create routing filter:", error);
    return apiError(request, 500, "Internal Server Error");
  }
}

/**
 * PATCH /api/routing/filters
 * Update an existing routing filter
 */
export async function PATCH(request) {
  try {
    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }

    const data = await request.json();
    const { id, ...updates } = data;

    if (!id) {
      return apiError(request, 400, "Filter ID is required");
    }

    // Validate filter_type if provided
    if (updates.filter_type) {
      const validTypes = ["trust_score", "ip_address", "country", "cost", "latency"];
      if (!validTypes.includes(updates.filter_type)) {
        return apiError(request, 400, `Invalid filter_type. Must be one of: ${validTypes.join(", ")}`);
      }
    }

    // Validate operator if provided
    if (updates.operator) {
      const validOperators = ["gte", "lte", "eq", "in_range", "in_list", "not_in_list"];
      if (!validOperators.includes(updates.operator)) {
        return apiError(request, 400, `Invalid operator. Must be one of: ${validOperators.join(", ")}`);
      }
    }

    // Validate action if provided
    if (updates.action && !["allow", "block"].includes(updates.action)) {
      return apiError(request, 400, "Invalid action. Must be 'allow' or 'block'");
    }

    const updated = await updateRoutingFilter(id, updates);
    if (!updated) {
      return apiError(request, 404, "Filter not found");
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update routing filter:", error);
    return apiError(request, 500, "Internal Server Error");
  }
}

/**
 * DELETE /api/routing/filters
 * Delete a routing filter
 */
export async function DELETE(request) {
  try {
    if (!(await checkAuth())) {
      return apiError(request, 401, "Unauthorized");
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return apiError(request, 400, "Filter ID is required");
    }

    const deleted = await deleteRoutingFilter(id);
    if (!deleted) {
      return apiError(request, 404, "Filter not found");
    }

    return NextResponse.json({ success: true, deleted });
  } catch (error) {
    console.error("Failed to delete routing filter:", error);
    return apiError(request, 500, "Internal Server Error");
  }
}
