import { NextResponse } from "next/server";
import {
  getRoutingFilters,
  getRoutingFilterById,
  createRoutingFilter,
  updateRoutingFilter,
  deleteRoutingFilter
} from "@/lib/localDb.js";
import { checkAuth } from "@/lib/auth/middleware.js";

/**
 * GET /api/routing/filters
 * Get all routing filters (optionally only active ones)
 */
export async function GET(request) {
  try {
    if (!(await checkAuth())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("activeOnly") === "true";

    const filters = await getRoutingFilters(activeOnly);
    return NextResponse.json({ filters });
  } catch (error) {
    console.error("Failed to get routing filters:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/routing/filters
 * Create a new routing filter
 */
export async function POST(request) {
  try {
    if (!(await checkAuth())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await request.json();

    // Validate required fields
    if (!data.name || !data.filter_type || !data.operator || data.value === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: name, filter_type, operator, value" },
        { status: 400 }
      );
    }

    // Validate filter_type
    const validTypes = ["trust_score", "ip_address", "country", "cost", "latency"];
    if (!validTypes.includes(data.filter_type)) {
      return NextResponse.json(
        { error: `Invalid filter_type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate operator
    const validOperators = ["gte", "lte", "eq", "in_range", "in_list", "not_in_list"];
    if (!validOperators.includes(data.operator)) {
      return NextResponse.json(
        { error: `Invalid operator. Must be one of: ${validOperators.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate action
    if (data.action && !["allow", "block"].includes(data.action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be 'allow' or 'block'" },
        { status: 400 }
      );
    }

    const filter = await createRoutingFilter(data);
    return NextResponse.json(filter, { status: 201 });
  } catch (error) {
    console.error("Failed to create routing filter:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/routing/filters
 * Update an existing routing filter
 */
export async function PATCH(request) {
  try {
    if (!(await checkAuth())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await request.json();
    const { id, ...updates } = data;

    if (!id) {
      return NextResponse.json(
        { error: "Filter ID is required" },
        { status: 400 }
      );
    }

    // Validate filter_type if provided
    if (updates.filter_type) {
      const validTypes = ["trust_score", "ip_address", "country", "cost", "latency"];
      if (!validTypes.includes(updates.filter_type)) {
        return NextResponse.json(
          { error: `Invalid filter_type. Must be one of: ${validTypes.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Validate operator if provided
    if (updates.operator) {
      const validOperators = ["gte", "lte", "eq", "in_range", "in_list", "not_in_list"];
      if (!validOperators.includes(updates.operator)) {
        return NextResponse.json(
          { error: `Invalid operator. Must be one of: ${validOperators.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Validate action if provided
    if (updates.action && !["allow", "block"].includes(updates.action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be 'allow' or 'block'" },
        { status: 400 }
      );
    }

    const updated = await updateRoutingFilter(id, updates);
    if (!updated) {
      return NextResponse.json(
        { error: "Filter not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update routing filter:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/routing/filters
 * Delete a routing filter
 */
export async function DELETE(request) {
  try {
    if (!(await checkAuth())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Filter ID is required" },
        { status: 400 }
      );
    }

    const deleted = await deleteRoutingFilter(id);
    if (!deleted) {
      return NextResponse.json(
        { error: "Filter not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, deleted });
  } catch (error) {
    console.error("Failed to delete routing filter:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
