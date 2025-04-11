#!/usr/bin/env python3
"""
Quality Assessment Module for OpenFOAM Casting Simulation Analyzer
Evaluates the overall quality of the casting based on analysis results
"""

def quality_assessment(results, config):
    """Perform overall quality assessment based on all analysis results"""
    quality_issues = []
    recommendations = []

    # Check for missing or error results first
    missing_analyses = []
    for expected in ['fill_status', 'temperature', 'velocity', 'turbulence']:
        if expected not in results:
            missing_analyses.append(expected)
        elif 'error' in results[expected]:
            quality_issues.append(f"Error in {expected} analysis: {results[expected]['error']}")

    if missing_analyses:
        quality_issues.append(f"Missing analysis results for: {', '.join(missing_analyses)}")
        recommendations.append("Check analyzer error output and ensure all required data files exist")

    # Check fill status
    if 'fill_status' in results:
        fill_status = results['fill_status']
        if 'unfilled_percentage' in fill_status:
            unfilled = fill_status['unfilled_percentage']
            acceptable_unfilled = config['quality_checks']['acceptable_unfilled_percentage']
        
            if unfilled > acceptable_unfilled:
                quality_issues.append(f"Incomplete filling detected ({unfilled*100:.2f}% unfilled > {acceptable_unfilled*100:.2f}%)")
                recommendations.append("Increase filling time or pouring temperature")
                recommendations.append("Check gating system design for restrictions")

    # Check temperature
    if 'temperature' in results:
        temp = results['temperature']
    
        # Check minimum temperature
        if 'min' in temp:
            min_temp = temp['min']
            min_acceptable = config['quality_checks']['min_front_temperature']
        
            if min_temp < min_acceptable:
                quality_issues.append(f"Temperature drops below critical threshold ({min_temp:.2f}°C < {min_acceptable}°C)")
                recommendations.append("Increase pouring temperature or mass flow rate")
    
        # Check temperature gradient
        if 'range' in temp:
            temp_range = temp['range']
            max_acceptable_gradient = config['quality_checks'].get('max_temperature_gradient', 100)
        
            if temp_range > max_acceptable_gradient:
                quality_issues.append(f"Extreme temperature gradient detected ({temp_range:.2f}°C > {max_acceptable_gradient}°C)")
                recommendations.append("Improve thermal uniformity by adjusting pouring temperature or gating design")
                recommendations.append("Consider preheating the mold to reduce thermal gradients")
    
        # Check for multiple temperature groups (indicating potential issues)
        if 'groups' in temp and temp['groups'] > 1:
            group_ranges = temp.get('group_ranges', [])
            if group_ranges:
                quality_issues.append(f"Multiple temperature regions detected ({temp['groups']} groups with significant temperature gaps)")
                recommendations.append("Check for potential flow separation or incomplete filling")

    # Check velocity 
    if 'velocity' in results:
        vel = results['velocity']
        min_acceptable = config['casting'].get('min_velocity', 0.5)
        max_acceptable = config['casting'].get('max_velocity', 1.5)
    
        # Check maximum velocity
        if 'max' in vel and vel['max'] > max_acceptable:
            quality_issues.append(f"Excessive flow velocity detected ({vel['max']:.2f} m/s > {max_acceptable} m/s)")
            recommendations.append("Reduce mass flow rate or modify gating design to slow down flow")
    
        # Check average velocity
        if 'average' in vel and vel['average'] < min_acceptable:
            quality_issues.append(f"Insufficient flow velocity ({vel['average']:.2f} m/s < {min_acceptable} m/s)")
            recommendations.append("Increase mass flow rate or modify gating system to improve flow")
    
        # Check for high velocity variation
        if 'max' in vel and 'min' in vel and 'average' in vel:
            vel_range = vel['max'] - vel['min']
            vel_avg = vel['average']
        
            if vel_range > 2 * vel_avg:
                quality_issues.append(f"High velocity variation detected (range: {vel_range:.2f} m/s, avg: {vel_avg:.2f} m/s)")
                recommendations.append("Improve gating design to achieve more uniform flow distribution")

    # Check turbulence
    if 'turbulence' in results:
        turb = results['turbulence']
        max_k_acceptable = config['quality_checks']['max_turbulent_kinetic_energy']
    
        if 'max_k' in turb and turb['max_k'] > max_k_acceptable:
            quality_issues.append(f"Excessive turbulence detected ({turb['max_k']:.4f} m²/s² > {max_k_acceptable} m²/s²)")
            recommendations.append("Redesign gating system to reduce turbulence, consider adding filters or flow controls")

    # Check Reynolds number 
    re = results.get('reynolds_number', 0)
    if re > 2000:
        quality_issues.append(f"Turbulent flow conditions detected (Re = {re:.2f} > 2000)")
        recommendations.append("Consider redesigning gates with smoother transitions to reduce turbulence")
    
        # Additional checks for high Reynolds number
        if re > 10000:
            quality_issues.append(f"Extremely turbulent flow detected (Re = {re:.2f} > 10000)")
            recommendations.append("High risk of mold erosion and entrapped gas - consider fundamental redesign of gating system")
            recommendations.append("Add flow control features such as filters or flow restrictors")

    # Store quality assessment in results
    results['quality_assessment'] = {
        'issues': quality_issues,
        'recommendations': recommendations,
        'overall_status': "Unsatisfactory" if quality_issues else "Satisfactory"
    }

    # Print quality assessment summary
    print("\n=== QUALITY ASSESSMENT SUMMARY ===")
    if quality_issues:
        print("Issues detected:")
        for i, issue in enumerate(quality_issues, 1):
            print(f"  {i}. {issue}")
    
        print("\nRecommendations:")
        for i, rec in enumerate(recommendations, 1):
            print(f"  {i}. {rec}")
    
        print("\nOverall status: UNSATISFACTORY")
    else:
        print("No significant issues detected.")
        print("Overall status: SATISFACTORY")

    return len(quality_issues) == 0